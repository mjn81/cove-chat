package com.cove.chat.ui.screens

/**
 * The id before or after [currentId] in a play queue, or null at either end or when the current track is not queued.
 * Mirrors `neighbour` in client-web `lib/playlist.ts`.
 *
 * @param ids queued track ids in chat order, oldest first.
 * @param direction 1 for the next track, -1 for the previous one.
 */
fun neighbourId(ids: List<String>, currentId: String, direction: Int): String? {
    val index = ids.indexOf(currentId)
    if (index < 0) return null
    return ids.getOrNull(index + direction)
}

/**
 * The title a playlist row and the player bar show: recorded voice notes are all named `voice-message.*`, which says
 * nothing, so they show the sender; music keeps its file name.
 */
fun playlistLabel(isVoice: Boolean, fileName: String, sender: String): String {
    if (isVoice || fileName.startsWith("voice-message", ignoreCase = true)) return sender.ifBlank { "Voice message" }
    return fileName
}
