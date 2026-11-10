package com.cove.chat.ui.screens

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.ServerUpdateInfo
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveConfirmDialog
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.ErrorBanner
import com.cove.chat.ui.components.FormField
import com.cove.chat.ui.components.SectionHeader
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.adm
import com.cove.chat.ui.components.adminError
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Owner-facing server controls that mirror client-web `notice-panel`, `server-update-panel`,
 * `server-update-upload` and `server-restart-control`: broadcast notices, update the server (online or from an
 * uploaded file) and restart it. The server re-checks the role and password on every call.
 */

private const val UPDATE_POLL_MS = 2000L
private const val RESTART_POLL_MS = 1500L
private const val RESTART_GIVE_UP_MS = 120_000L

/** Mirrors the server's limit (`maxNoticeLen`); the server re-validates. */
private const val MAX_NOTICE_LENGTH = 2000

// ── Notices ─────────────────────────────────────────────────────────────────

/** Owner-only form that sends a message from the server's Cove account to every user. Delivered notices cannot be recalled. */
@Composable
internal fun NoticePanel() {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    Text(adm("admin.notices.title"), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.SemiBold)
    Text(adm("admin.notices.description"), color = c.textMuted, style = CoveType.caption)
    Spacer(Modifier.height(Spacing.md))
    CoveTextField(
        text, { if (it.length <= MAX_NOTICE_LENGTH) text = it },
        Modifier.fillMaxWidth(), placeholder = adm("admin.notices.placeholder"), singleLine = false, height = 140.dp
    )
    Row(Modifier.fillMaxWidth().padding(top = Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Text("${text.length} / $MAX_NOTICE_LENGTH", color = c.textMuted, style = CoveType.caption, modifier = Modifier.weight(1f))
        CoveButton(adm("admin.notices.send"), { confirming = true }, enabled = text.isNotBlank() && !busy, loading = busy)
    }

    if (confirming) {
        CoveConfirmDialog(
            title = adm("admin.notices.confirmTitle"), message = adm("admin.notices.confirmMessage"),
            confirmLabel = adm("admin.notices.send"), onDismiss = { confirming = false },
            onConfirm = {
                confirming = false
                busy = true
                scope.launch {
                    api.adminSendNotice(text.trim()).fold({
                        text = ""
                        toast(context, adm("admin.notices.sent", "n" to it.recipients.toString()))
                        if (it.failed > 0) toast(context, adm("admin.notices.failed", "n" to it.failed.toString()))
                    }, { toast(context, adminError(it.message)) })
                    busy = false
                }
            }
        )
    }
}

// ── Server update ───────────────────────────────────────────────────────────

/**
 * Overview card for the server self-update: installed vs latest version, release notes and (owner only) the
 * "Update server" button plus the offline upload. While an update runs it follows the job, then waits for the
 * restarted server to come back on the new version.
 */
@Composable
internal fun ServerUpdateCard(isOwner: Boolean) {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<ServerUpdateInfo?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var pollFailed by remember { mutableStateOf(false) }
    var target by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    var confirmSource by remember { mutableStateOf<String?>(null) }

    val stage = serverUpdateStage(info, target, pollFailed)
    val busy = isUpdateBusy(stage)

    // Poll while a job runs on this server (started here or by another admin) or while this device waits for the new version.
    LaunchedEffect(busy, target) {
        if (info == null || busy || target != null) {
            while (true) {
                api.adminUpdateInfo().fold(
                    { info = it; pollFailed = false; loadError = null },
                    { if (info == null) loadError = adminError(it.message) else pollFailed = true }
                )
                if (!busy && info != null && target == null) break
                delay(UPDATE_POLL_MS)
            }
        }
    }
    LaunchedEffect(stage) {
        if (stage == ServerUpdateStage.DONE) {
            toast(context, adm("admin.update.done", "version" to target.orEmpty()))
            target = null
        }
    }

    val current = info
    if (current == null) {
        loadError?.let { ErrorBanner(it) }
        return
    }

    SectionHeader(adm("admin.update.title"))
    AdminCard {
        InfoRow(adm("admin.update.current"), current.currentVersion)
        Spacer(Modifier.height(Spacing.sm))
        InfoRow(
            adm("admin.update.latest"),
            (current.latestVersion.ifEmpty { "—" }) + if (current.prerelease) " · ${adm("admin.update.prerelease")}" else ""
        )
        current.checkError?.let { Text(adminError(it), color = c.textMuted, style = CoveType.caption) }
        current.source?.let {
            val name = adm(if (it == "manifest") "admin.update.source_manifest" else "admin.update.source_github")
            Text("${adm("admin.update.source_label")} $name", color = c.textMuted, style = CoveType.caption, modifier = Modifier.padding(top = Spacing.xs))
        }
        Spacer(Modifier.height(Spacing.sm))
        CoveButton(
            adm("admin.update.check_now"),
            {
                checking = true
                scope.launch {
                    api.adminUpdateInfo(refresh = true).fold({ info = it }, { toast(context, adminError(it.message)) })
                    checking = false
                }
            },
            variant = ButtonVariant.Outline, size = ButtonSize.Sm, loading = checking, enabled = !busy
        )
    }

    if (current.mode == "docker") {
        Spacer(Modifier.height(Spacing.sm))
        DockerInstructions(current.instructions.orEmpty())
    }

    if (current.updateAvailable && current.releaseNotes.isNotBlank()) {
        Spacer(Modifier.height(Spacing.sm))
        ReleaseNotes(current)
    }

    if (isOwner && current.mode != "docker" && !busy) {
        Spacer(Modifier.height(Spacing.sm))
        UpdateUpload(
            current, enabled = current.mode == "binary",
            onStaged = { info = current.copy(uploaded = it) },
            onInstall = { confirmSource = "upload" }
        )
    }

    if (busy) {
        Spacer(Modifier.height(Spacing.sm))
        val key = when (stage) {
            ServerUpdateStage.DOWNLOADING -> "admin.update.stage_downloading"
            ServerUpdateStage.INSTALLING -> "admin.update.stage_installing"
            ServerUpdateStage.RESTARTING -> "admin.update.stage_restarting"
            else -> "admin.update.stage_reconnecting"
        }
        Text(adm(key), color = c.textPrimary, style = CoveType.label)
        if (stage == ServerUpdateStage.DOWNLOADING) {
            LinearProgressIndicator(progress = { current.progressPercent / 100f }, modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs))
        }
    }

    if (stage == ServerUpdateStage.FAILED) {
        Spacer(Modifier.height(Spacing.sm))
        ErrorBanner(adm("admin.update.failed", "reason" to adminError(current.error)))
    }

    if (isOwner && !busy) {
        Spacer(Modifier.height(Spacing.sm))
        val reason = when (current.reason) {
            "docker" -> adm("admin.update.reason_docker")
            "unsupported" -> adm("admin.update.reason_unsupported")
            "up_to_date" -> adm("admin.update.up_to_date")
            else -> null
        }
        reason?.let { Text(it, color = c.textMuted, style = CoveType.caption) }
        Spacer(Modifier.height(Spacing.xs))
        CoveButton(adm("admin.update.button"), { confirmSource = "release" }, enabled = current.canUpdate)
    } else if (!isOwner && current.updateAvailable) {
        Text(adm("admin.update.owner_only"), color = c.textMuted, style = CoveType.caption, modifier = Modifier.padding(top = Spacing.sm))
    }

    confirmSource?.let { source ->
        val version = if (source == "upload") current.uploaded?.version.orEmpty() else current.latestVersion
        StepUpDialog(
            title = adm("admin.update.confirm_title", "version" to version),
            description = "${adm("admin.update.confirm_body")} ${adm("admin.update.confirm_detail")}",
            confirmLabel = adm("admin.update.confirm_action"),
            onDismiss = { confirmSource = null }
        ) { password, _ ->
            // A wrong password fails the call and StepUpDialog shows the message inside the dialog.
            api.adminStartUpdate(source, password).map { target = it.version }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    val c = CoveTheme.extendedColors
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = c.textMuted, style = CoveType.label, modifier = Modifier.weight(1f))
        Text(value, color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.Medium)
    }
}

/** Docker installs are replaced by pulling a new image, never in place; shows the exact commands. */
@Composable
private fun DockerInstructions(command: String) {
    val c = CoveTheme.extendedColors
    AdminCard {
        Text(adm("admin.update.docker_title"), color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.Medium)
        Text(adm("admin.update.docker_body"), color = c.textMuted, style = CoveType.caption)
        if (command.isNotBlank()) {
            SelectionContainer {
                Text(command, color = c.textPrimary, style = CoveType.caption, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(vertical = Spacing.xs))
            }
        }
        Text(adm("admin.update.docker_watchtower"), color = c.textMuted, style = CoveType.caption)
    }
}

@Composable
private fun ReleaseNotes(info: ServerUpdateInfo) {
    val c = CoveTheme.extendedColors
    var expanded by remember { mutableStateOf(false) }
    AdminCard {
        Text(adm("admin.update.notes", "version" to info.latestVersion), color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.Medium)
        com.cove.chat.ui.components.MarkdownDocument(
            if (expanded) previewReleaseNotes(info.releaseNotes, 4000) else previewReleaseNotes(info.releaseNotes),
            color = c.textMuted, linkColor = MaterialTheme.colorScheme.primary, fontSize = CoveType.caption.fontSize,
            modifier = Modifier.padding(top = Spacing.xs)
        )
        if (info.releaseNotes.trim().length > 280) {
            CoveButton(if (expanded) "▲" else "▼", { expanded = !expanded }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
    }
}

/**
 * Offline update for installs that cannot reach the release servers: the owner picks the release zip (or binary)
 * and types its version and, ideally, its checksum. This only stages the file; Install applies it.
 */
@Composable
private fun UpdateUpload(info: ServerUpdateInfo, enabled: Boolean, onStaged: (com.cove.chat.data.model.ServerUploadInfo) -> Unit, onInstall: () -> Unit) {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var file by remember { mutableStateOf<Pair<String, ByteArray>?>(null) }
    var version by remember { mutableStateOf("") }
    var checksum by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val picked = withContext(Dispatchers.IO) {
                runCatching {
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "update"
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("no stream")
                    name to bytes
                }.getOrNull()
            }
            if (picked == null) toast(context, adm("admin.errors.invalid_upload")) else file = picked
        }
    }

    AdminCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(adm("admin.update.upload_title"), color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            CoveButton(if (open) "▲" else "▼", { open = !open }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
        if (open) {
            Text(adm("admin.update.upload_body"), color = c.textMuted, style = CoveType.caption)
            Spacer(Modifier.height(Spacing.sm))
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FormField(adm("admin.update.upload_file"), required = true) {
                    CoveButton(file?.first ?: adm("admin.update.upload_file"), { pick.launch(arrayOf("*/*")) }, variant = ButtonVariant.Outline, size = ButtonSize.Sm, enabled = enabled)
                }
                FormField(adm("admin.update.upload_version"), required = true) {
                    CoveTextField(version, { version = it }, placeholder = "0.10.0", enabled = enabled)
                }
                FormField(adm("admin.update.upload_sha"), hint = adm("admin.update.upload_sha_hint")) {
                    CoveTextField(checksum, { checksum = it }, singleLine = false, height = 80.dp, enabled = enabled)
                }
                CoveButton(
                    adm("admin.update.upload_button"), { confirm = true },
                    variant = ButtonVariant.Outline, size = ButtonSize.Sm,
                    enabled = enabled && file != null && version.isNotBlank()
                )
            }
        }
        info.uploaded?.let { up ->
            Spacer(Modifier.height(Spacing.sm))
            val checked = adm(if (up.verified) "admin.update.checked_yes" else "admin.update.checked_no")
            Text(adm("admin.update.uploaded", "version" to up.version, "checked" to checked), color = c.textPrimary, style = CoveType.caption)
            Spacer(Modifier.height(Spacing.xs))
            CoveButton(adm("admin.update.apply"), onInstall, size = ButtonSize.Sm, enabled = enabled)
        }
    }

    if (confirm) {
        StepUpDialog(
            title = adm("admin.update.upload_title"), description = adm("admin.update.upload_confirm"),
            confirmLabel = adm("admin.update.upload_button"), onDismiss = { confirm = false }
        ) { password, _ ->
            val picked = file ?: return@StepUpDialog Result.success(Unit)
            val field = classifyChecksumInput(checksum)
            api.adminUploadUpdate(picked.second, version.trim(), password, field.sha256, field.sums).map {
                toast(context, adm("admin.update.upload_done"))
                file = null
                onStaged(it)
            }
        }
    }
}

// ── Restart ─────────────────────────────────────────────────────────────────

/**
 * Owner-only "Restart server" button with the password step-up and a wait-until-back indicator. Install types
 * that cannot restart themselves (Docker, unknown) get a disabled button and the reason.
 *
 * @param card adds a titled frame (Overview); false renders just the row (under a setting).
 */
@Composable
internal fun ServerRestartControl(card: Boolean = true) {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val c = CoveTheme.extendedColors
    var info by remember { mutableStateOf<ServerUpdateInfo?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var requested by remember { mutableStateOf(false) }
    var baseline by remember { mutableStateOf(0L) }

    LaunchedEffect(Unit) { api.adminUpdateInfo().onSuccess { info = it } }

    // Waiting for the server: a failed poll then a good one (or a smaller uptime than before) proves it restarted.
    LaunchedEffect(requested) {
        if (!requested) return@LaunchedEffect
        var sawDown = false
        var waited = 0L
        while (waited < RESTART_GIVE_UP_MS) {
            delay(RESTART_POLL_MS)
            waited += RESTART_POLL_MS
            api.adminOverview().fold({
                if (serverRestartStage(true, sawDown, it.uptimeSeconds, baseline) == ServerRestartStage.DONE) {
                    requested = false
                    toast(context, adm("admin.restart.done"))
                    return@LaunchedEffect
                }
            }, { sawDown = true })
        }
        requested = false
        toast(context, adm("admin.restart.timeout"))
    }

    val current = info ?: return
    val restarting = requested
    if (card) SectionHeader(adm("admin.restart.title"))
    val body: @Composable () -> Unit = {
        Text(
            when {
                restarting -> adm("admin.restart.waiting")
                current.canRestart -> adm("admin.restart.hint")
                current.mode == "docker" -> adm("admin.restart.reason_docker")
                else -> adm("admin.restart.reason_unsupported")
            },
            color = c.textMuted, style = CoveType.caption
        )
        Spacer(Modifier.height(Spacing.sm))
        CoveButton(adm("admin.restart.button"), { confirm = true }, variant = ButtonVariant.Outline, enabled = current.canRestart && !restarting, loading = restarting)
    }
    if (card) AdminCard { body() } else Column(Modifier.padding(top = Spacing.md)) { body() }

    if (confirm) {
        StepUpDialog(
            title = adm("admin.restart.confirm_title"), description = adm("admin.restart.confirm_body"),
            confirmLabel = adm("admin.restart.confirm_action"), onDismiss = { confirm = false }
        ) { password, _ ->
            val before = api.adminOverview().getOrNull()?.uptimeSeconds ?: 0L
            api.adminRestartServer(password).onSuccess { baseline = before; requested = true }
        }
    }
}
