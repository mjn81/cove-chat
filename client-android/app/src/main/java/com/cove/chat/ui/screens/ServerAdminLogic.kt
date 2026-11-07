package com.cove.chat.ui.screens

import com.cove.chat.data.model.ServerUpdateInfo

/*
 * Pure state logic for the owner's server update / restart controls. Mirrors client-web
 * `domains/admin/utils/server-update.ts` and `server-restart.ts` so both clients agree on when an update is done.
 */

/** What the update card shows; `RECONNECTING` covers the gap while the server process is being replaced. */
enum class ServerUpdateStage { IDLE, DOWNLOADING, INSTALLING, RESTARTING, RECONNECTING, DONE, FAILED }

/**
 * Decides which stage the update card is in. The device that started the update tracks [target]: once the server
 * answers with that version and an idle job, it is done. Without a target the card just mirrors the server's job.
 */
fun serverUpdateStage(info: ServerUpdateInfo?, target: String?, pollFailed: Boolean): ServerUpdateStage {
    if (target == null) {
        return when (info?.state) {
            "downloading" -> ServerUpdateStage.DOWNLOADING
            "installing" -> ServerUpdateStage.INSTALLING
            "restarting" -> ServerUpdateStage.RESTARTING
            else -> ServerUpdateStage.IDLE
        }
    }
    if (info?.state == "idle" && info.currentVersion == target) return ServerUpdateStage.DONE
    if (info?.state == "failed") return ServerUpdateStage.FAILED
    if (pollFailed) return ServerUpdateStage.RECONNECTING
    return when (info?.state) {
        "restarting" -> ServerUpdateStage.RESTARTING
        "installing" -> ServerUpdateStage.INSTALLING
        else -> ServerUpdateStage.DOWNLOADING
    }
}

/** True while polling must continue (an update is running or its outcome is not yet known). */
fun isUpdateBusy(stage: ServerUpdateStage): Boolean =
    stage != ServerUpdateStage.IDLE && stage != ServerUpdateStage.DONE && stage != ServerUpdateStage.FAILED

/** The checksum box holds either one SHA-256 digest or a whole SHA256SUMS file; the server wants them in different fields. */
data class ChecksumField(val sha256: String? = null, val sums: String? = null)

private val SHA256_HEX = Regex("^[0-9a-fA-F]{64}$")

/** A lone 64-character hex digest is the file's SHA-256; any longer text is sent as `sums` and matched by file name. */
fun classifyChecksumInput(text: String): ChecksumField {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return ChecksumField()
    return if (SHA256_HEX.matches(trimmed)) ChecksumField(sha256 = trimmed.lowercase()) else ChecksumField(sums = trimmed)
}

/** Release notes shortened for the collapsed preview. */
fun previewReleaseNotes(notes: String, max: Int = 280): String {
    val text = notes.trim()
    return if (text.length <= max) text else text.take(max).trimEnd() + "…"
}

/** Where a "Restart server" request stands, from this device's point of view. */
enum class ServerRestartStage { IDLE, RESTARTING, DONE }

/**
 * A failed poll followed by a successful one proves the restart. When the restart is quick enough that no poll ever
 * failed, an uptime lower than before the request proves it instead.
 */
fun serverRestartStage(requested: Boolean, sawDown: Boolean, uptimeSeconds: Long?, baselineUptime: Long): ServerRestartStage {
    if (!requested) return ServerRestartStage.IDLE
    if (uptimeSeconds == null) return ServerRestartStage.RESTARTING
    return if (sawDown || uptimeSeconds < baselineUptime) ServerRestartStage.DONE else ServerRestartStage.RESTARTING
}
