package com.cove.chat.ui.screens

import com.cove.chat.CoveApp
import com.cove.chat.crypto.CryptoManager
import com.cove.chat.data.model.Message
import com.cove.chat.data.model.fileMeta
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Re-sends [m] into [targetChannelId] and reports whether it went out.
 *
 * Text and invitations are decrypted and encrypted again with the target chat's key. Media (files, voice notes, video
 * messages) is downloaded, decrypted with the source key and uploaded again for the target chat, together with its
 * preview (thumbnail or waveform) and duration, so it arrives exactly as if it had been sent there.
 */
suspend fun forwardMessage(m: Message, targetChannelId: String): Boolean = withContext(Dispatchers.IO) {
    runCatching {
        when (m.type) {
            "text", "invite" ->
                CoveApp.instance.webSocketManager.sendChatMessage(
                    targetChannelId, CryptoManager.decryptMessage(m.channelId, m.ciphertext, m.nonce), type = m.type
                )
            "file", "voice", "video" -> {
                val meta = m.fileMeta()
                val bytes = meta?.let { loadAttachment(m.channelId, it) }
                if (meta == null || bytes == null) false
                else {
                    sendPrepared(
                        targetChannelId, bytes, meta.mime, meta.name, m.type,
                        asDocument = meta.asDocument == true, durationSec = meta.duration, preview = decryptPreview(m.channelId, meta)
                    )
                    true
                }
            }
            else -> false
        }
    }.getOrDefault(false)
}
