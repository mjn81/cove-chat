package com.cove.chat.whisper

import android.content.Context
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.cove.chat.data.remote.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.security.KeyPair
import java.util.UUID

/** Attachment carried inside a Whisper message payload (`kind` is `file`, `voice` or `video`, like the web `type`). */
class WhisperFile(
    val name: String, val mime: String, val size: Long, val kind: String,
    val duration: Int?, val waveform: List<Int>?, val bytes: ByteArray
)

/** One decrypted Whisper message: text, an attachment, or both. Plaintext is held in memory only. */
class WhisperMessage(
    val id: String, val senderId: String, val text: String?, val file: WhisperFile?, val sentAt: Long, val expiresAt: Long?
)

/** A Whisper request from a friend that the user can accept or decline. */
class WhisperInvite(val sessionId: String, val initiatorId: String, val initiatorName: String, val pubKey: String, val expiryMode: String)

/** Waiting for the peer, encrypted and live, ended (history may remain), or burned (everything destroyed). */
enum class WhisperStatus { Pending, Active, Closed, Burned }

class WhisperSession(
    val id: String,
    val peerId: String,
    val peerName: String,
    val expiryMode: String,
    val keyPair: KeyPair?,
    val initiatedByMe: Boolean,
    val createdAt: Long = System.currentTimeMillis()
) {
    var status by mutableStateOf(WhisperStatus.Pending)
    var safetyNumber by mutableStateOf<String?>(null)
    var verified by mutableStateOf(false)
    var endedReason by mutableStateOf<String?>(null)
    var key: ByteArray? = null
    val messages = mutableStateListOf<WhisperMessage>()
    internal var stored: StoredWhisperSession? = null
    internal var messagesLoaded = false

    /** Whether this mode keeps history on this device (everything except `session_only`). */
    val persists: Boolean get() = expiryMode != "session_only"
}

/** System-notification hooks, implemented by `NotificationHelper`, so Whisper requests work from the background. */
interface WhisperNotifier {
    fun request(invite: WhisperInvite)
    fun cancelRequest(sessionId: String)
    fun message(session: WhisperSession)
}

/**
 * Whisper sessions: end-to-end chats relayed by the server (`whisper_*` events, backend/internal/ws/handlers.go).
 * The server never sees keys or plaintext and stores nothing. Keys, plaintext and attachments live in memory; for the
 * `persistent`/`5m`/`1h`/`24h` modes the session key and the wire ciphertext are also kept in the device-local
 * [WhisperStore] (the Android equivalent of the web client's IndexedDB), and `session_only` never touches disk.
 * Attachments opened for viewing are decrypted into `cacheDir/whisper` and wiped with their message / session.
 */
class WhisperManager(
    private val context: Context,
    private val ws: WebSocketManager,
    private val myId: () -> String?,
    private val myName: () -> String? = { null }
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val sessions = mutableStateMapOf<String, WhisperSession>()
    private val invites = LinkedHashMap<String, WhisperInvite>()
    private var storeFor: Pair<String, WhisperStore>? = null
    var notifier: WhisperNotifier? = null

    /** First pending incoming request; the app shows a dialog while this is non-null. */
    var invite by mutableStateOf<WhisperInvite?>(null)
        private set

    /** Session the UI should open next (set when a request is accepted from a notification). */
    var openRequest by mutableStateOf<String?>(null)

    /** Session whose screen is currently visible, so its messages do not also raise a notification. */
    @Volatile var openSessionId: String? = null

    init {
        scope.launch { ws.whisperFlow.collect { (type, payload) -> runCatching { handle(type, payload.jsonObject) } } }
        scope.launch {
            // Expiry modes ("5m", "1h", "24h") delete messages once they run out; the disk sweep is slower.
            var tick = 0
            while (true) {
                delay(1000)
                val now = System.currentTimeMillis()
                sessions.values.forEach { s -> s.messages.removeAll { m -> (m.expiresAt != null && m.expiresAt < now).also { if (it) tempFile(m)?.delete() } } }
                if (++tick % 30 == 0) store()?.purgeExpired()
            }
        }
    }

    private fun store(): WhisperStore? {
        val me = myId() ?: return null
        storeFor?.let { if (it.first == me) return it.second }
        return WhisperStore(context, me).also { storeFor = me to it }
    }

    /** Loads the sessions kept on this device for the signed-in user (idempotent; history shows as ended sessions). */
    fun loadPersisted() {
        val st = store() ?: return
        scope.launch {
            st.loadSessions().forEach { ss ->
                if (sessions.containsKey(ss.sessionId)) return@forEach
                sessions[ss.sessionId] = WhisperSession(ss.sessionId, ss.peerId, ss.peerName, ss.expiryMode, null, ss.initiatedByMe, ss.createdAt).also {
                    it.key = ss.key; it.safetyNumber = ss.safetyNumber; it.verified = ss.verified; it.stored = ss
                    it.status = WhisperStatus.Closed
                    it.endedReason = "This Whisper ended. Saved messages stay on this device."
                }
            }
        }
    }

    /** Decrypts the saved messages of a stored session the first time it is opened. */
    fun ensureMessages(sessionId: String) {
        val s = sessions[sessionId] ?: return
        if (s.messagesLoaded || s.stored == null) return
        s.messagesLoaded = true
        val key = s.key ?: return
        val st = store() ?: return
        scope.launch {
            val loaded = st.loadMessages(sessionId).mapNotNull { m ->
                runCatching { parse(m.id, m.senderId, WhisperCrypto.decrypt(key, m.ciphertext, m.nonce), m.sentAt, m.expiresAt) }.getOrNull()
            }
            s.messages.addAll(0, loaded)
        }
    }

    /** The live (pending or active) session with a friend, if any. */
    fun sessionForPeer(peerId: String): WhisperSession? =
        sessions.values.firstOrNull { it.peerId == peerId && (it.status == WhisperStatus.Pending || it.status == WhisperStatus.Active) }

    /** The newest saved (ended) session with a friend, whose history can still be read. */
    fun savedSessionForPeer(peerId: String): WhisperSession? =
        sessions.values.filter { it.peerId == peerId && it.status == WhisperStatus.Closed && it.stored != null }.maxByOrNull { it.createdAt }

    private fun pubKeyB64(kp: KeyPair) = Base64.encodeToString(WhisperCrypto.exportPublicKey(kp.public), Base64.NO_WRAP)

    /** Starts a session with a friend; returns its id. The peer must accept before keys are derived. */
    fun start(peerId: String, peerName: String, expiryMode: String): String {
        sessionForPeer(peerId)?.let { return it.id }
        val id = "whisper-" + UUID.randomUUID()
        val kp = WhisperCrypto.generateKeyPair()
        sessions[id] = WhisperSession(id, peerId, peerName, expiryMode, kp, initiatedByMe = true)
        scope.launch {
            ws.sendSignaling("whisper_init", buildJsonObject {
                put("session_id", id)
                put("target_user_id", peerId)
                put("pub_key", pubKeyB64(kp))
                put("expiry_mode", expiryMode)
            })
        }
        return id
    }

    /** Accepts a request made visible by the dialog or a notification action; returns the session id. */
    fun acceptById(sessionId: String): String? = invites[sessionId]?.let { accept(it) }

    fun accept(inv: WhisperInvite): String {
        removeInvite(inv.sessionId)
        val kp = WhisperCrypto.generateKeyPair()
        val session = WhisperSession(inv.sessionId, inv.initiatorId, inv.initiatorName, inv.expiryMode, kp, initiatedByMe = false)
        val secrets = WhisperCrypto.deriveSecrets(
            kp.private, WhisperCrypto.importPublicKey(Base64.decode(inv.pubKey, Base64.NO_WRAP)),
            inv.sessionId, myId().orEmpty(), inv.initiatorId
        )
        session.key = secrets.sessionKey
        session.safetyNumber = secrets.safetyNumber
        session.status = WhisperStatus.Active
        sessions[inv.sessionId] = session
        persistSession(session)
        scope.launch {
            ws.sendSignaling("whisper_accept", buildJsonObject {
                put("session_id", inv.sessionId)
                put("pub_key", pubKeyB64(kp))
            })
        }
        return inv.sessionId
    }

    fun declineById(sessionId: String) { invites[sessionId]?.let { decline(it) } }

    fun decline(inv: WhisperInvite) {
        removeInvite(inv.sessionId)
        scope.launch { ws.sendSignaling("whisper_reject", buildJsonObject { put("session_id", inv.sessionId); put("reason", "declined") }) }
    }

    private fun removeInvite(sessionId: String) {
        invites.remove(sessionId)
        invite = invites.values.firstOrNull()
        notifier?.cancelRequest(sessionId)
    }

    private fun persistSession(s: WhisperSession) {
        if (!s.persists) return
        val key = s.key ?: return
        val ss = StoredWhisperSession(s.id, s.peerId, s.peerName, s.expiryMode, key, s.safetyNumber.orEmpty(), s.verified, s.createdAt, s.initiatedByMe)
        s.stored = ss
        scope.launch { runCatching { store()?.saveSession(ss) } }
    }

    /** Toggles the "I compared the safety number" mark; kept on disk for persistent modes. */
    fun setVerified(sessionId: String, verified: Boolean) {
        val s = sessions[sessionId] ?: return
        s.verified = verified
        s.stored?.let { ss -> scope.launch { runCatching { store()?.setVerified(ss, verified) } }; s.stored = StoredWhisperSession(ss.sessionId, ss.peerId, ss.peerName, ss.expiryMode, ss.key, ss.safetyNumber, verified, ss.createdAt, ss.initiatedByMe) }
    }

    fun send(sessionId: String, text: String) {
        if (text.isBlank()) return
        dispatch(sessionId, text, null)
    }

    /** Sends a file, voice note (`kind` = voice) or video message (`kind` = video) inside the encrypted session. */
    fun sendFile(sessionId: String, file: WhisperFile) = dispatch(sessionId, null, file)

    private fun dispatch(sessionId: String, text: String?, file: WhisperFile?) {
        val s = sessions[sessionId] ?: return
        val key = s.key ?: return
        if (s.status != WhisperStatus.Active) return
        val now = System.currentTimeMillis()
        val expiresAt = expiryFor(s.expiryMode, now)
        val payload = buildJsonObject {
            if (text != null) put("text", text)
            if (file != null) put("file", buildJsonObject {
                put("name", file.name); put("mime", file.mime); put("size", file.size)
                put("dataBase64", Base64.encodeToString(file.bytes, Base64.NO_WRAP))
                put("type", file.kind)
                file.duration?.let { put("duration", it) }
                file.waveform?.let { w -> put("waveform", JsonArray(w.map { JsonPrimitive(it) })) }
            })
        }
        val (ct, nonce) = WhisperCrypto.encrypt(key, payload.toString())
        val id = UUID.randomUUID().toString()
        scope.launch {
            ws.sendSignaling("whisper_msg", buildJsonObject {
                put("session_id", sessionId)
                put("ciphertext", ct)
                put("nonce", nonce)
                if (expiresAt != null) put("expires_at", expiresAt) else put("expires_at", JsonNull)
            })
            if (s.persists) runCatching { store()?.saveMessage(sessionId, StoredWhisperMessage(id, myId().orEmpty(), ct, nonce, now, expiresAt)) }
        }
        s.messages.add(WhisperMessage(id, myId().orEmpty(), text, file, now, expiresAt))
    }

    /** Ends the session for both sides. Keeps nothing for `session_only`; other modes keep their local history. */
    fun close(sessionId: String) {
        val s = sessions[sessionId] ?: return
        if (s.status == WhisperStatus.Pending || s.status == WhisperStatus.Active) {
            scope.launch { ws.sendSignaling("whisper_close", buildJsonObject { put("session_id", sessionId); put("reason", "closed") }) }
        }
        if (s.persists && s.stored != null && s.status != WhisperStatus.Pending) {
            // Keep the saved history, drop the live state.
            s.status = WhisperStatus.Closed
            s.endedReason = "Session closed. Saved messages stay on this device."
            clearTemp(s)
        } else {
            wipe(s, null, deleteStored = true)
            sessions.remove(sessionId)
        }
    }

    /** Burn: the peer is told to destroy the chat too, and every key, message and stored copy here is deleted. */
    fun burn(sessionId: String) {
        val s = sessions[sessionId] ?: return
        if (s.status == WhisperStatus.Pending || s.status == WhisperStatus.Active) {
            scope.launch { ws.sendSignaling("whisper_close", buildJsonObject { put("session_id", sessionId); put("reason", "burned") }) }
        }
        wipe(s, null, deleteStored = true)
        sessions.remove(sessionId)
    }

    /** Removes an ended session (and its saved history) from this device. */
    fun forget(sessionId: String) {
        val s = sessions.remove(sessionId) ?: return
        wipe(s, null, deleteStored = true)
    }

    /** A decrypted copy of an attachment for the system viewer / players; deleted with the message. */
    fun tempFile(m: WhisperMessage): File? {
        val f = m.file ?: return null
        val dir = File(context.cacheDir, "whisper").apply { mkdirs() }
        val safe = f.name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifBlank { "file" }
        return File(dir, "${m.id}_$safe")
    }

    /** Writes the decrypted attachment to its temp file (once) and returns it. */
    fun materialize(m: WhisperMessage): File? {
        val file = tempFile(m) ?: return null
        if (!file.exists()) file.writeBytes(m.file!!.bytes)
        return file
    }

    private fun clearTemp(s: WhisperSession) { s.messages.forEach { tempFile(it)?.delete() } }

    private fun expiryFor(mode: String, now: Long): Long? = when (mode) {
        "5m" -> now + 5 * 60_000L
        "1h" -> now + 60 * 60_000L
        "24h" -> now + 24 * 60 * 60_000L
        else -> null
    }

    private fun wipe(s: WhisperSession, reason: String?, deleteStored: Boolean) {
        clearTemp(s)
        s.key = null
        s.messages.clear()
        s.status = if (deleteStored) WhisperStatus.Burned else WhisperStatus.Closed
        s.endedReason = reason
        if (deleteStored) { s.stored = null; scope.launch { runCatching { store()?.deleteSession(s.id) } } }
    }

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.contentOrNull

    private fun parse(id: String, senderId: String, raw: String, sentAt: Long, expiresAt: Long?): WhisperMessage {
        val obj = runCatching { Json.parseToJsonElement(raw).jsonObject }.getOrNull()
            ?: return WhisperMessage(id, senderId, raw, null, sentAt, expiresAt)
        val f = obj["file"] as? JsonObject
        val file = f?.let {
            val mime = str(it, "mime") ?: "application/octet-stream"
            WhisperFile(
                str(it, "name") ?: "attachment", mime, (it["size"] as? JsonPrimitive)?.longOrNull ?: 0L,
                str(it, "type") ?: if (mime.startsWith("audio/")) "voice" else if (mime.startsWith("video/")) "video" else "file",
                (it["duration"] as? JsonPrimitive)?.intOrNull, (it["waveform"] as? JsonArray)?.mapNotNull { w -> (w as? JsonPrimitive)?.intOrNull },
                Base64.decode(str(it, "dataBase64").orEmpty(), Base64.DEFAULT)
            )
        }
        return WhisperMessage(id, senderId, str(obj, "text"), file, sentAt, expiresAt)
    }

    private fun handle(type: String, p: JsonObject) {
        val id = str(p, "session_id") ?: return
        when (type) {
            "whisper_init" -> {
                val from = str(p, "initiator_id").orEmpty()
                if (from == myId() || sessions[id]?.status == WhisperStatus.Active) return
                val inv = WhisperInvite(id, from, str(p, "initiator_username") ?: "Someone", str(p, "pub_key").orEmpty(), str(p, "expiry_mode") ?: "persistent")
                invites[id] = inv
                if (invite == null) invite = inv
                notifier?.request(inv)
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
                    persistSession(s)
                }.onFailure { wipe(s, "Couldn't establish the encrypted session.", deleteStored = false) }
            }
            "whisper_msg" -> {
                val s = sessions[id] ?: return
                val key = s.key ?: return
                val ct = str(p, "ciphertext").orEmpty()
                val nonce = str(p, "nonce").orEmpty()
                runCatching {
                    val sentAt = (p["sent_at"] as? JsonPrimitive)?.longOrNull ?: System.currentTimeMillis()
                    val expiresAt = (p["expires_at"] as? JsonPrimitive)?.longOrNull
                    val msg = parse(UUID.randomUUID().toString(), str(p, "sender_id").orEmpty(), WhisperCrypto.decrypt(key, ct, nonce), sentAt, expiresAt)
                    s.messages.add(msg)
                    if (s.persists) runCatching { store()?.saveMessage(id, StoredWhisperMessage(msg.id, msg.senderId, ct, nonce, sentAt, expiresAt)) }
                    // Content is never put into a notification; it only says who whispered.
                    if (openSessionId != id) notifier?.message(s)
                }
            }
            "whisper_reject" -> {
                sessions[id]?.let { wipe(it, "Your request was declined.", deleteStored = false) }
            }
            "whisper_close" -> {
                // The initiator withdrew a request that has not been answered yet.
                if (invites.containsKey(id)) { removeInvite(id); return }
                val s = sessions[id] ?: return
                val burned = str(p, "reason") == "burned"
                when {
                    burned -> { wipe(s, "This chat was burned and all data destroyed.", deleteStored = true); s.status = WhisperStatus.Burned }
                    s.persists && s.stored != null -> {
                        clearTemp(s)
                        s.status = WhisperStatus.Closed
                        s.endedReason = if (str(p, "reason") == "peer_disconnected") "Peer disconnected. Saved messages stay on this device." else "The other person ended the session. Saved messages stay on this device."
                    }
                    else -> wipe(s, if (str(p, "reason") == "peer_disconnected") "Peer disconnected." else "The other person ended the session.", deleteStored = false)
                }
            }
            "whisper_error" -> sessions[id]?.let {
                if (it.status == WhisperStatus.Pending || it.status == WhisperStatus.Active) {
                    if (it.persists && it.stored != null) { it.status = WhisperStatus.Closed; it.endedReason = str(p, "error") ?: "Session closed due to an error." }
                    else wipe(it, str(p, "error") ?: "Session closed due to an error.", deleteStored = false)
                }
            }
        }
    }

    /** Called when the user signs out: drops everything held in memory (stored history stays encrypted on disk). */
    fun reset() {
        sessions.values.forEach { clearTemp(it); it.key = null; it.messages.clear() }
        sessions.clear(); invites.clear(); invite = null; storeFor = null
    }
}
