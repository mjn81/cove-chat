package com.cove.chat.data.model

import com.cove.chat.crypto.CryptoManager
import kotlinx.serialization.json.Json

private val metaJson = Json { ignoreUnknownKeys = true }

/** Parses the decrypted JSON body of a `file` message; null when it isn't valid file metadata. */
fun Message.fileMeta(): FileMeta? {
    if (type != "file" && type != "voice" && type != "video") return null
    val raw = CryptoManager.decryptMessage(channelId, ciphertext, nonce)
    return runCatching { metaJson.decodeFromString<FileMeta>(raw) }.getOrNull()
}

/** One-line description of a message for notifications and list previews (decrypts client-side). */
fun Message.previewText(): String = when (type) {
    "text" -> CryptoManager.decryptMessage(channelId, ciphertext, nonce)
    "file" -> fileMeta()?.let { if (it.mime.startsWith("image/")) "Sent a photo" else "Sent a file: ${it.name}" } ?: "Sent a file"
    "voice" -> "Sent a voice message"
    "video" -> "Sent a video message"
    else -> "Sent a $type"
}
