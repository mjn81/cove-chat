package com.cove.chat.whisper

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.security.MessageDigest

/** What survives on disk for a non-`session_only` Whisper: the session key and metadata, never plaintext. */
class StoredWhisperSession(
    val sessionId: String, val peerId: String, val peerName: String, val expiryMode: String,
    val key: ByteArray, val safetyNumber: String, val verified: Boolean, val createdAt: Long, val initiatedByMe: Boolean
)

/** One stored message exactly as it crossed the wire (AES-GCM ciphertext + nonce, base64), like the web `whisperDb`. */
class StoredWhisperMessage(
    val id: String, val senderId: String, val ciphertext: String, val nonce: String, val sentAt: Long, val expiresAt: Long?
)

/**
 * Device-local persistence for Whisper sessions whose expiry mode keeps history (`persistent`, `5m`, `1h`, `24h`),
 * the Android counterpart of client-web `lib/whisperDb.ts` (IndexedDB). Nothing here is ever sent to the server and
 * `session_only` Whispers never reach this class. Every file is wrapped by [EncryptedFile] (AES-256-GCM, key in the
 * Android Keystore) on top of the message ciphertext, so the session key is not readable from app storage.
 *
 * Layout: `<root>/<sha256(sessionId)>/session.bin` plus one `m_<sentAt>_<expiresAt|0>_<id>.bin` per message; the
 * expiry is in the file name so purging never has to decrypt anything. Session ids come from the other party, hence
 * the hashed directory name (no path traversal).
 */
class WhisperStore(private val context: Context, userId: String) {
    private val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    private val root = File(context.filesDir, "whisper/" + hash(userId)).apply { mkdirs() }

    private fun hash(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)
    private fun dir(sessionId: String) = File(root, hash(sessionId))

    private fun write(file: File, bytes: ByteArray) {
        file.parentFile?.mkdirs()
        // EncryptedFile refuses to overwrite.
        if (file.exists()) file.delete()
        EncryptedFile.Builder(context, file, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB).build().openFileOutput().use { it.write(bytes) }
    }

    private fun read(file: File): ByteArray? = runCatching {
        EncryptedFile.Builder(context, file, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB).build().openFileInput().use { it.readBytes() }
    }.getOrNull()

    private fun str(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.contentOrNull

    fun saveSession(s: StoredWhisperSession) {
        val json = buildJsonObject {
            put("session_id", s.sessionId); put("peer_id", s.peerId); put("peer_name", s.peerName); put("expiry_mode", s.expiryMode)
            put("key", android.util.Base64.encodeToString(s.key, android.util.Base64.NO_WRAP))
            put("safety_number", s.safetyNumber); put("verified", s.verified); put("created_at", s.createdAt); put("initiated_by_me", s.initiatedByMe)
        }
        write(File(dir(s.sessionId), "session.bin"), json.toString().toByteArray())
    }

    fun loadSessions(): List<StoredWhisperSession> = (root.listFiles() ?: emptyArray()).mapNotNull { d ->
        val bytes = read(File(d, "session.bin")) ?: return@mapNotNull null
        runCatching {
            val o = Json.parseToJsonElement(String(bytes)).jsonObject
            StoredWhisperSession(
                str(o, "session_id").orEmpty(), str(o, "peer_id").orEmpty(), str(o, "peer_name").orEmpty(), str(o, "expiry_mode") ?: "persistent",
                android.util.Base64.decode(str(o, "key").orEmpty(), android.util.Base64.NO_WRAP), str(o, "safety_number").orEmpty(),
                str(o, "verified") == "true", (o["created_at"] as? JsonPrimitive)?.longOrNull ?: 0L, str(o, "initiated_by_me") == "true"
            )
        }.getOrNull()
    }

    fun setVerified(s: StoredWhisperSession, verified: Boolean) = saveSession(
        StoredWhisperSession(s.sessionId, s.peerId, s.peerName, s.expiryMode, s.key, s.safetyNumber, verified, s.createdAt, s.initiatedByMe)
    )

    fun saveMessage(sessionId: String, m: StoredWhisperMessage) {
        val json = buildJsonObject {
            put("id", m.id); put("sender_id", m.senderId); put("ciphertext", m.ciphertext); put("nonce", m.nonce); put("sent_at", m.sentAt)
        }
        write(File(dir(sessionId), "m_${m.sentAt}_${m.expiresAt ?: 0}_${m.id.filter { it.isLetterOrDigit() || it == '-' }}.bin"), json.toString().toByteArray())
    }

    /** Stored messages oldest first; files whose expiry has passed are skipped (and removed by [purgeExpired]). */
    fun loadMessages(sessionId: String, now: Long = System.currentTimeMillis()): List<StoredWhisperMessage> =
        (dir(sessionId).listFiles { f -> f.name.startsWith("m_") } ?: emptyArray()).sortedBy { it.name.split('_').getOrNull(1)?.toLongOrNull() ?: 0L }.mapNotNull { f ->
            val parts = f.name.split('_')
            val exp = parts.getOrNull(2)?.toLongOrNull()?.takeIf { it > 0 }
            if (exp != null && exp <= now) return@mapNotNull null
            val bytes = read(f) ?: return@mapNotNull null
            runCatching {
                val o = Json.parseToJsonElement(String(bytes)).jsonObject
                StoredWhisperMessage(str(o, "id").orEmpty(), str(o, "sender_id").orEmpty(), str(o, "ciphertext").orEmpty(), str(o, "nonce").orEmpty(), (o["sent_at"] as? JsonPrimitive)?.longOrNull ?: 0L, exp)
            }.getOrNull()
        }

    fun deleteSession(sessionId: String) { dir(sessionId).deleteRecursively() }

    /** Deletes every expired message file on disk; returns how many. */
    fun purgeExpired(now: Long = System.currentTimeMillis()): Int {
        var n = 0
        root.listFiles()?.forEach { d ->
            d.listFiles { f -> f.name.startsWith("m_") }?.forEach { f ->
                val exp = f.name.split('_').getOrNull(2)?.toLongOrNull()?.takeIf { it > 0 }
                if (exp != null && exp <= now && f.delete()) n++
            }
        }
        return n
    }

    fun clearAll() { root.deleteRecursively(); root.mkdirs() }
}
