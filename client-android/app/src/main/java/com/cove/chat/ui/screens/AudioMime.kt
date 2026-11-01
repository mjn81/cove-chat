package com.cove.chat.ui.screens

/** Audio extensions a picker may return with no (or a generic) MIME type, mapped to the type players expect. */
private val audioExtensions = mapOf(
    "mp3" to "audio/mpeg",
    "m4a" to "audio/mp4",
    "m4b" to "audio/mp4",
    "aac" to "audio/aac",
    "ogg" to "audio/ogg",
    "oga" to "audio/ogg",
    "opus" to "audio/ogg",
    "wav" to "audio/wav",
    "flac" to "audio/flac",
    "amr" to "audio/amr",
    "3gp" to "audio/3gpp",
    "wma" to "audio/x-ms-wma",
    "mid" to "audio/midi",
    "midi" to "audio/midi",
    "weba" to "audio/webm",
)

/** Non-standard audio types some providers report; they are rewritten so every client agrees on one name. */
private val audioAliases = mapOf(
    "audio/mp3" to "audio/mpeg",
    "audio/x-mpeg" to "audio/mpeg",
    "audio/x-wav" to "audio/wav",
    "audio/wave" to "audio/wav",
    "audio/x-m4a" to "audio/mp4",
    "audio/m4a" to "audio/mp4",
    "audio/x-flac" to "audio/flac",
    "audio/x-aac" to "audio/aac",
)

/**
 * Picks the MIME type to send for a picked file. Content providers often report nothing or
 * `application/octet-stream` for music, which made songs show up as plain files, so the extension fills the gap.
 *
 * @param reported what `ContentResolver.getType` returned, if anything.
 * @param fileName the display name, used for the extension fallback.
 */
fun resolveMime(reported: String?, fileName: String): String {
    val mime = reported?.lowercase()?.trim().orEmpty()
    audioAliases[mime]?.let { return it }
    if (mime.isNotEmpty() && mime != "application/octet-stream") return mime
    val ext = fileName.substringAfterLast('.', "").lowercase()
    return audioExtensions[ext] ?: reported ?: "application/octet-stream"
}

/** True when a file of this MIME type is shown as an audio player in the chat instead of a file card. */
fun isInlineAudio(mime: String): Boolean = mime.startsWith("audio/")
