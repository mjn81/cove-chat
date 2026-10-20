package com.nodetalk.client.whisper

import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.nodetalk.client.data.remote.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.KeyPair
import java.util.UUID

/** One decrypted Whisper message. Held in memory only. */
class WhisperMessage(val id: String, val senderId: String, val text: String, val sentAt: Long, val expiresAt: Long?)

/** A Whisper request from a friend that the user can accept or decline. */
class WhisperInvite(val sessionId: String, val initiatorId: String, val initiatorName: String, val pubKey: String, val expiryMode: String)

/** Lifecycle of a session: waiting for the peer, encrypted and live, or ended (with an optional reason). */
enum class WhisperStatus { Pending, Active, Closed }

class WhisperSession(
    val id: String,
    val peerId: String,
    val peerName: String,
    val expiryMode: String,
    val keyPair: KeyPair?
) {
    var status by mutableStateOf(WhisperStatus.Pending)
    var safetyNumber by mutableStateOf<String?>(null)
    var endedReason by mutableStateOf<String?>(null)
    var key: ByteArray? = null
    val messages = mutableStateListOf<WhisperMessage>()
}

/**
 * Whisper sessions: zero-persistence end-to-end chats relayed by the server (`whisper_*` events).
 * Private keys, session keys and plaintext exist only in this object's memory and vanish with the process
 * or when the session is closed; nothing is written to disk. Protocol: backend/internal/ws/handlers.go.
 */
class WhisperManager(private val ws: WebSocketManager, private val myId: () -> String?) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val sessions = mutableStateMapOf<String, WhisperSession>()

    /** Pending incoming request; the app shows a dialog while this is non-null. */
    var invite by mutableStateOf<WhisperInvite?>(null)
        private set

    init {
        scope.launch { ws.whisperFlow.collect { (type, payload) -> handle(type, payload.jsonObject) } }
        scope.launch {
            // Expiry modes ("5m", "1h", "24h") delete messages locally once they run out.
            while (true) {
                delay(1000)
                val now = System.currentTimeMillis()
                sessions.values.forEach { s -> s.messages.removeAll { it.expiresAt != null && it.expiresAt < now } }
            }
        }
    }

    fun sessionForPeer(peerId: String): WhisperSession? =
        sessions.values.firstOrNull { it.peerId == peerId && it.status != WhisperStatus.Closed }

    /** Starts a session with a friend; returns its id. The peer must accept before keys are derived. */
    fun start(peerId: String, peerName: String, expiryMode: String): String {
        sessionForPeer(peerId)?.let { return it.id }
        val id = UUID.randomUUID().toString()
        val kp = WhisperCrypto.generateKeyPair()
        sessions[id] = WhisperSession(id, peerId, peerName, expiryMode, kp)
        scope.launch {
            ws.sendSignaling("whisper_init", buildJsonObject {
                put("session_id", id)
                put("target_user_id", peerId)
                put("pub_key", Base64.encodeToString(WhisperCrypto.exportPublicKey(kp.public), Base64.NO_WRAP))
                put("expiry_mode", expiryMode)
            })
        }
        return id
    }

    fun accept(inv: WhisperInvite): String {
        invite = null
        val kp = WhisperCrypto.generateKeyPair()
        val session = WhisperSession(inv.sessionId, inv.initiatorId, inv.initiatorName, inv.expiryMode, kp)
        val secrets = WhisperCrypto.deriveSecrets(
            kp.private, WhisperCrypto.importPublicKey(Base64.decode(inv.pubKey, Base64.NO_WRAP)),
            inv.sessionId, myId().orEmpty(), inv.initiatorId
        )
        session.key = secrets.sessionKey
        session.safetyNumber = secrets.safetyNumber
        session.status = WhisperStatus.Active
        sessions[inv.sessionId] = session
        scope.launch {
            ws.sendSignaling("whisper_accept", buildJsonObject {
                put("session_id", inv.sessionId)
                put("pub_key", Base64.encodeToString(WhisperCrypto.exportPublicKey(kp.public), Base64.NO_WRAP))
            })
        }
        return inv.sessionId
    }

    fun decline(inv: WhisperInvite) {
        invite = null
        scope.launch { ws.sendSignaling("whisper_reject", buildJsonObject { put("session_id", inv.sessionId); put("reason", "declined") }) }
    }

    fun send(sessionId: String, text: String) {
        val s = sessions[sessionId] ?: return
        val key = s.key ?: return
        if (s.status != WhisperStatus.Active || text.isBlank()) return
        val now = System.currentTimeMillis()
        val expiresAt = expiryFor(s.expiryMode, now)
        val (ct, nonce) = WhisperCrypto.encrypt(key, JsonObject(mapOf("text" to JsonPrimitive(text))).toString())
        scope.launch {
            ws.sendSignaling("whisper_msg", buildJsonObject {
                put("session_id", sessionId)
                put("ciphertext", ct)
                put("nonce", nonce)
                if (expiresAt != null) put("expires_at", expiresAt) else put("expires_at", JsonNull)
            })
        }
        s.messages.add(WhisperMessage(UUID.randomUUID().toString(), myId().orEmpty(), text, now, expiresAt))
    }

    /** Ends the session for both sides and drops every key and message held for it. */
    fun close(sessionId: String) {
        val s = sessions[sessionId] ?: return
        if (s.status != WhisperStatus.Closed) {
            scope.launch { ws.sendSignaling("whisper_close", buildJsonObject { put("session_id", sessionId); put("reason", "closed") }) }
        }
        wipe(s, null)
        sessions.remove(sessionId)
    }

    private fun expiryFor(mode: String, now: Long): Long? = when (mode) {
        "5m" -> now + 5 * 60_000L
        "1h" -> now + 60 * 60_000L
        "24h" -> now + 24 * 60 * 60_000L
        else -> null
    }

    private fun wipe(s: WhisperSession, reason: String?) {
        s.key = null
        s.messages.clear()
        s.status = WhisperStatus.Closed
        s.endedReason = reason
    }

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.contentOrNull

    private fun handle(type: String, p: JsonObject) {
        val id = str(p, "session_id") ?: return
        when (type) {
            "whisper_init" -> {
                invite = WhisperInvite(
                    id, str(p, "initiator_id").orEmpty(), str(p, "initiator_username") ?: "Someone",
                    str(p, "pub_key").orEmpty(), str(p, "expiry_mode") ?: "persistent"
                )
            }
            "whisper_accept" -> {
                val s = sessions[id] ?: return
                val kp = s.keyPair ?: return
                runCatching {
                    val secrets = WhisperCrypto.deriveSecrets(
                        kp.private, WhisperCrypto.importPublicKey(Base64.decode(str(p, "pub_key").orEmpty(), Base64.NO_WRAP)),
                        id, myId().orEmpty(), s.peerId
                    )
                    s.key = secrets.sessionKey
                    s.safetyNumber = secrets.safetyNumber
                    s.status = WhisperStatus.Active
                }.onFailure { wipe(s, "Couldn't establish the encrypted session.") }
            }
            "whisper_msg" -> {
                val s = sessions[id] ?: return
                val key = s.key ?: return
                runCatching {
                    val raw = WhisperCrypto.decrypt(key, str(p, "ciphertext").orEmpty(), str(p, "nonce").orEmpty())
                    val obj = runCatching { Json.parseToJsonElement(raw).jsonObject }.getOrNull()
                    val file = obj?.get("file") as? JsonObject
                    val text = obj?.get("text")?.jsonPrimitive?.contentOrNull
                        ?: file?.let { "Sent a file (${str(it, "name") ?: "attachment"}); open it on the web or desktop client." }
                        ?: raw
                    s.messages.add(
                        WhisperMessage(
                            UUID.randomUUID().toString(), str(p, "sender_id").orEmpty(), text,
                            (p["sent_at"] as? JsonPrimitive)?.longOrNull ?: System.currentTimeMillis(),
                            (p["expires_at"] as? JsonPrimitive)?.longOrNull
                        )
                    )
                }
            }
            "whisper_reject" -> sessions[id]?.let { wipe(it, "Your request was declined.") }
            "whisper_close" -> sessions[id]?.let { wipe(it, "The other person ended the session.") }
            "whisper_error" -> sessions[id]?.let { if (it.status == WhisperStatus.Pending) wipe(it, str(p, "error")) }
        }
    }
}
