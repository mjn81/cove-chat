package com.nodetalk.client.ui.screens

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.CoveApp
import com.nodetalk.client.data.model.AdminAccount
import com.nodetalk.client.data.model.ConfigSetting
import com.nodetalk.client.data.model.CreateInviteRequest
import com.nodetalk.client.data.model.Invite
import com.nodetalk.client.ui.components.ButtonSize
import com.nodetalk.client.ui.components.ButtonVariant
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.CoveChip
import com.nodetalk.client.ui.components.CoveChoiceList
import com.nodetalk.client.ui.components.CoveDialog
import com.nodetalk.client.ui.components.CoveIconButton
import com.nodetalk.client.ui.components.CoveSegmented
import com.nodetalk.client.ui.components.CoveSwitchRow
import com.nodetalk.client.ui.components.CoveTextField
import com.nodetalk.client.ui.components.DialogSize
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FormField
import com.nodetalk.client.ui.components.I18nToast
import com.nodetalk.client.ui.components.IconButtonVariant
import com.nodetalk.client.ui.components.Segment
import com.nodetalk.client.ui.components.SectionHeader
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.adm
import com.nodetalk.client.ui.components.admOr
import com.nodetalk.client.ui.components.adminError
import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Spacing
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private enum class AdminTab(val labelKey: String) {
    Overview("admin.tabs.overview"),
    Registration("admin.tabs.registration"),
    Config("admin.tabs.config"),
    Admins("admin.tabs.admins"),
    Data("admin.tabs.data")
}

/** Whether a stored `server_role` may open the panel. UI gating only; the server re-checks the role on every request. */
fun isServerAdmin(role: String?): Boolean = role == "admin" || role == "owner"

/**
 * Server administration (mirrors client-web `AdminTab`): overview, registration and invites, config, admins and,
 * for the owner, backup / reset / delete. [onLogout] runs after the server was deleted.
 */
@Composable
fun AdminPage(onLogout: () -> Unit) {
    val app = CoveApp.instance
    var role by remember { mutableStateOf(app.preferencesManager.serverRole) }
    var tab by remember { mutableStateOf(AdminTab.Overview) }
    val isOwner = role == "owner"

    LaunchedEffect(Unit) { app.apiClient.getMe().onSuccess { role = app.preferencesManager.serverRole } }
    // Losing the owner role (ownership transfer) removes the Data tab, so never stay on it.
    if (tab == AdminTab.Data && !isOwner) tab = AdminTab.Overview
    if (!isServerAdmin(role)) return

    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        AdminTab.entries.filter { it != AdminTab.Data || isOwner }.forEach {
            CoveChip(adm(it.labelKey), selected = tab == it, onClick = { tab = it })
        }
    }
    Spacer(Modifier.height(Spacing.xl))
    when (tab) {
        AdminTab.Overview -> OverviewPanel()
        AdminTab.Registration -> RegistrationPanel()
        AdminTab.Config -> ConfigPanel(isOwner)
        AdminTab.Admins -> AdminsPanel(isOwner, onRoleChanged = { role = app.preferencesManager.serverRole })
        AdminTab.Data -> DataPanel(onLogout)
    }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

private fun toast(context: Context, text: String) = I18nToast.make(context, text, Toast.LENGTH_SHORT).show()

/** Fetch-on-open state holder: [data] is null until the first answer, [error] is display text. */
private class Loader<T>(private val scope: CoroutineScope, private val fetch: suspend () -> Result<T>) {
    var data by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)

    fun reload() {
        loading = true
        scope.launch {
            fetch().fold({ data = it; error = null }, { error = adminError(it.message) })
            loading = false
        }
    }
}

@Composable
private fun <T> rememberLoader(fetch: suspend () -> Result<T>): Loader<T> {
    val scope = rememberCoroutineScope()
    val loader = remember { Loader(scope, fetch) }
    LaunchedEffect(Unit) { loader.reload() }
    return loader
}

@Composable
private fun Loading() {
    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
}

@Composable
private fun <T> Loader<T>.Await(content: @Composable (T) -> Unit) {
    val value = data
    error?.let { ErrorBanner(it); Spacer(Modifier.height(Spacing.md)) }
    if (value != null) content(value) else if (loading) Loading()
}

@Composable
private fun AdminCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = CoveTheme.extendedColors
    Column(modifier.fillMaxWidth().clip(CoveShapes.md).border(1.dp, c.border, CoveShapes.md).background(c.card).padding(Spacing.md)) { content() }
}

private fun formatUptime(seconds: Long): String {
    val d = seconds / 86400
    val h = seconds % 86400 / 3600
    val m = seconds % 3600 / 60
    return when {
        d > 0 -> "${d}d ${h}h"
        h > 0 -> "${h}h ${m}m"
        else -> "${m}m"
    }
}

private val dateFormat: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

private fun formatDate(iso: String): String =
    runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(dateFormat) }.getOrDefault(iso)

/** Locally computed status, so a code that expires while the panel is open updates without a refetch. */
private fun liveStatus(inv: Invite): String = when {
    inv.revoked -> "revoked"
    inv.expiresAt != null && runCatching { OffsetDateTime.parse(inv.expiresAt).toInstant() <= Instant.now() }.getOrDefault(false) -> "expired"
    inv.maxUses > 0 && inv.uses >= inv.maxUses -> "exhausted"
    else -> "active"
}

private fun JsonElement.text(): String = (this as? JsonPrimitive)?.content.orEmpty()

// ── Step-up dialog ──────────────────────────────────────────────────────────

/**
 * Password re-entry gate for dangerous actions. The backend verifies the password again on every call, so a
 * hijacked session alone cannot wipe or export the server; this dialog is only the UI for that check.
 *
 * @param phrase when set, the admin must type this exact text before the button enables.
 * @param needsPassphrase asks for an archive passphrase (backups, 12+ characters).
 * @param onSubmit runs the action; a failure is shown inside the dialog and keeps it open.
 */
@Composable
private fun StepUpDialog(
    title: String,
    description: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    phrase: String? = null,
    needsPassphrase: Boolean = false,
    onSubmit: suspend (password: String, passphrase: String) -> Result<Unit>
) {
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var passphrase by remember { mutableStateOf("") }
    var typed by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ready = password.isNotEmpty() && (phrase == null || typed == phrase) && (!needsPassphrase || passphrase.length >= 12)

    CoveDialog(
        onDismiss = { if (!busy) onDismiss() },
        title = title,
        size = DialogSize.Sm,
        footer = {
            CoveButton("Cancel", onDismiss, variant = ButtonVariant.Ghost, enabled = !busy)
            CoveButton(
                confirmLabel,
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        onSubmit(password, passphrase).fold({ onDismiss() }, { error = adminError(it.message); busy = false })
                    }
                },
                variant = if (destructive) ButtonVariant.Destructive else ButtonVariant.Default,
                enabled = ready, loading = busy
            )
        }
    ) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(description, color = c.textMuted, style = CoveType.label)
            FormField(adm("admin.step_up.password"), required = true) {
                CoveTextField(password, { password = it }, password = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false))
            }
            if (needsPassphrase) {
                FormField(adm("admin.step_up.passphrase"), required = true, hint = adm("admin.step_up.passphrase_hint")) {
                    CoveTextField(passphrase, { passphrase = it }, password = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false))
                }
            }
            if (phrase != null) {
                FormField(adm("admin.step_up.type_to_confirm", "phrase" to phrase), required = true) {
                    CoveTextField(typed, { typed = it }, enabled = !busy, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
                }
            }
            error?.let { ErrorBanner(it) }
        }
    }
}

// ── Overview ────────────────────────────────────────────────────────────────

@Composable
private fun OverviewPanel() {
    val api = CoveApp.instance.apiClient
    val c = CoveTheme.extendedColors
    val overview = rememberLoader { api.adminOverview() }
    val audit = rememberLoader { api.adminAudit() }

    overview.Await { o ->
        val stats = listOf(
            adm("admin.overview.users") to o.users.toString(),
            adm("admin.overview.channels") to o.channels.toString(),
            adm("admin.overview.active_invites") to o.activeInvites.toString(),
            adm("admin.overview.uptime") to formatUptime(o.uptimeSeconds),
            adm("admin.overview.data_size") to formatBytes(o.dataSizeBytes),
            adm("admin.overview.version") to o.version
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            stats.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    pair.forEach { (label, value) ->
                        AdminCard(Modifier.weight(1f)) {
                            Text(label, color = c.textMuted, style = CoveType.caption)
                            Text(value, color = c.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        }
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(Spacing.xl))
    SectionHeader(adm("admin.audit.title"), Modifier.padding(horizontal = 0.dp))
    audit.Await { entries ->
        if (entries.isEmpty()) {
            Text(adm("admin.audit.empty"), color = c.textMuted, style = CoveType.label)
        } else {
            AdminCard {
                entries.take(50).forEachIndexed { i, e ->
                    if (i > 0) Spacer(Modifier.height(Spacing.md))
                    Text(
                        "${e.actorName} ${admOr("admin.audit.actions.${e.action}", e.action)}" + (e.target?.let { " $it" } ?: ""),
                        color = c.textPrimary, style = CoveType.label
                    )
                    Text(formatDate(e.at), color = c.textMuted, style = CoveType.caption)
                }
            }
        }
    }
}

// ── Registration + invites ──────────────────────────────────────────────────

@Composable
private fun RegistrationPanel() {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = CoveTheme.extendedColors
    val clipboard = LocalClipboardManager.current
    val config = rememberLoader { api.adminConfig() }
    val invites = rememberLoader { api.adminInvites() }
    var saving by remember { mutableStateOf(false) }
    // Codes stay masked (stream-friendly) until the row's eye is tapped.
    val shown = remember { mutableStateMapOf<String, Boolean>() }

    val mode = config.data?.firstOrNull { it.key == "registration.mode" }?.value?.text()

    if (mode == null) { config.Await { } } else {
        FormField(adm("admin.registration.mode"), hint = adm("admin.registration.mode_${mode}_hint")) {
            CoveChoiceList(
                listOf("open", "invite_only", "closed").map { it to adm("admin.registration.mode_$it") },
                selected = mode, enabled = !saving
            ) { next ->
                if (next == mode) return@CoveChoiceList
                saving = true
                scope.launch {
                    api.adminUpdateConfig(mapOf("registration.mode" to JsonPrimitive(next))).fold(
                        { toast(context, adm("admin.registration.saved")); config.reload() },
                        { toast(context, adminError(it.message)) }
                    )
                    saving = false
                }
            }
        }
    }

    Spacer(Modifier.height(Spacing.xl))
    SectionHeader(adm("admin.invites.title"))
    InviteForm(onCreated = { invites.reload() })
    Spacer(Modifier.height(Spacing.md))
    invites.Await { list ->
        if (list.isEmpty()) {
            Text(adm("admin.invites.empty"), color = c.textMuted, style = CoveType.label)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            list.forEach { inv ->
                val status = liveStatus(inv)
                AdminCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            val reveal = shown[inv.code] == true
                            Text(if (reveal) inv.code else "•".repeat(inv.code.length), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium)
                            Text(
                                listOfNotNull(
                                    adm("admin.invites.status_$status"),
                                    adm("admin.invites.uses", "uses" to "${inv.uses} / ${if (inv.maxUses > 0) inv.maxUses.toString() else "∞"}"),
                                    inv.expiresAt?.let { adm("admin.invites.expires_on", "date" to formatDate(it)) },
                                    if (inv.source == "config") adm("admin.invites.from_config") else null
                                ).joinToString(" · "),
                                color = if (status == "active") MaterialTheme.colorScheme.primary else c.textMuted, style = CoveType.caption
                            )
                            inv.note?.takeIf { it.isNotBlank() }?.let { Text(it, color = c.textMuted, style = CoveType.caption) }
                        }
                        CoveIconButton(
                            if (shown[inv.code] == true) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            adm(if (shown[inv.code] == true) "admin.invites.hide" else "admin.invites.show"),
                            { shown[inv.code] = shown[inv.code] != true }
                        )
                        CoveIconButton(Icons.Outlined.ContentCopy, adm("admin.invites.copy"), {
                            clipboard.setText(AnnotatedString(inv.code))
                            toast(context, adm("admin.invites.copied"))
                        })
                        if (inv.source == "panel" && status != "revoked") {
                            CoveIconButton(Icons.Outlined.Delete, adm("admin.invites.revoke"), {
                                scope.launch {
                                    api.adminRevokeInvite(inv.code).fold({ invites.reload() }, { toast(context, adminError(it.message)) })
                                }
                            }, variant = IconButtonVariant.Destructive)
                        }
                    }
                }
            }
        }
    }
}

/** Creates an invitation code: limited (N uses) or unlimited, with an optional expiry date, custom code and note. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InviteForm(onCreated: () -> Unit) {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = CoveTheme.extendedColors
    var unlimited by remember { mutableStateOf(false) }
    var maxUses by remember { mutableStateOf("1") }
    var expiresAt by remember { mutableStateOf<LocalDateTime?>(null) }
    var pickedDay by remember { mutableStateOf<LocalDate?>(null) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    var code by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    val uses = maxUses.toIntOrNull()
    val valid = unlimited || (uses != null && uses in 1..1_000_000)

    AdminCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            FormField(adm("admin.invites.type")) {
                CoveSegmented(
                    listOf(Segment(adm("admin.invites.type_limited")), Segment(adm("admin.invites.type_unlimited"))),
                    selectedIndex = if (unlimited) 1 else 0, onSelect = { unlimited = it == 1 }
                )
            }
            if (!unlimited) {
                FormField(adm("admin.invites.max_uses"), required = true) {
                    CoveTextField(maxUses, { maxUses = it.filter(Char::isDigit).take(7) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
            }
            FormField(adm("admin.invites.expires"), hint = adm("admin.invites.expires_hint")) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    CoveButton(
                        expiresAt?.format(dateFormat) ?: "None",
                        onClick = { pickDate = true }, variant = ButtonVariant.Outline, size = ButtonSize.Md, modifier = Modifier.weight(1f)
                    )
                    if (expiresAt != null) CoveIconButton(Icons.Outlined.Close, "Clear", { expiresAt = null })
                }
            }
            FormField(adm("admin.invites.code"), hint = adm("admin.invites.code_hint")) {
                CoveTextField(code, { code = it.take(64) }, password = true, revealed = false, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
            }
            FormField(adm("admin.invites.note")) {
                CoveTextField(note, { note = it.take(200) })
            }
            CoveButton(
                adm("admin.invites.create"), enabled = valid, loading = busy, modifier = Modifier.fillMaxWidth(),
                onClick = {
                    busy = true
                    // Chosen local date and time, sent as a UTC instant like the web form does.
                    val expiry = expiresAt?.atZone(ZoneId.systemDefault())?.toInstant()?.toString()
                    scope.launch {
                        api.adminCreateInvite(
                            CreateInviteRequest(code.trim().ifEmpty { null }, note.trim().ifEmpty { null }, if (unlimited) 0 else uses ?: 1, expiry)
                        ).fold(
                            {
                                // The code goes to the clipboard, never into the toast, so it stays off a shared screen.
                                clipboard.setText(AnnotatedString(it.code))
                                toast(context, adm("admin.invites.created_copied")); code = ""; note = ""; onCreated()
                            },
                            { toast(context, adminError(it.message)) }
                        )
                        busy = false
                    }
                }
            )
        }
    }

    if (pickDate) {
        val state = rememberDatePickerState()
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton({
                    // The picker reports UTC midnight of the chosen calendar day.
                    pickedDay = state.selectedDateMillis?.let { Instant.ofEpochMilli(it).atOffset(ZoneOffset.UTC).toLocalDate() }
                    pickDate = false
                    pickTime = pickedDay != null
                }) { Text(adm("common.confirm"), color = MaterialTheme.colorScheme.primary) }
            },
            dismissButton = { TextButton({ pickDate = false }) { Text("Cancel", color = c.textMuted) } }
        ) { DatePicker(state) }
    }

    if (pickTime) {
        // Defaults to 23:59 so a date-only choice still covers the whole day.
        val time = rememberTimePickerState(initialHour = 23, initialMinute = 59, is24Hour = true)
        CoveDialog(
            onDismiss = { pickTime = false }, title = adm("admin.invites.expires"), size = DialogSize.Sm,
            footer = {
                CoveButton("Cancel", { pickTime = false }, variant = ButtonVariant.Ghost)
                CoveButton(adm("common.confirm"), {
                    expiresAt = pickedDay?.atTime(time.hour, time.minute)
                    pickTime = false
                })
            }
        ) { Column(Modifier.fillMaxWidth().padding(Spacing.lg), horizontalAlignment = Alignment.CenterHorizontally) { TimePicker(time) } }
    }
}

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * Schema-driven editor for config.toml. The server decides which keys exist and which need the owner; this panel
 * never invents a setting. Owner-only keys are disabled for admins (the server rejects them anyway).
 */
@Composable
private fun ConfigPanel(isOwner: Boolean) {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val config = rememberLoader { api.adminConfig() }
    val draft = remember { mutableStateMapOf<String, String>() }
    var askPassword by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    config.Await { all ->
        // Registration lives in its own tab.
        val settings = all.filter { it.key != "registration.mode" }
        val dirty = settings.filter { s -> draft[s.key]?.let { it != s.value.text() } == true }
        val needsOwner = dirty.any { it.ownerOnly }
        val invalid = dirty.any { draft[it.key].isNullOrBlank() && it.type != "string" }

        fun changes() = dirty.associate { s ->
            s.key to when (s.type) {
                "bool" -> JsonPrimitive(draft[s.key] == "true")
                "int" -> JsonPrimitive(draft[s.key]?.toLongOrNull() ?: 0L)
                else -> JsonPrimitive(draft[s.key].orEmpty())
            }
        }

        suspend fun run(password: String?): Result<Unit> = api.adminUpdateConfig(changes(), password).map {
            draft.clear()
            toast(context, adm("admin.config.saved"))
            if (it.restartRequired.isNotEmpty()) toast(context, adm("admin.config.restart_needed"))
            config.reload()
        }

        settings.map { it.group }.distinct().forEach { group ->
            SectionHeader(admOr("admin.config.groups.$group", group))
            settings.filter { it.group == group }.forEach { s ->
                SettingEditor(s, draft[s.key] ?: s.value.text(), enabled = !s.ownerOnly || isOwner) { draft[s.key] = it }
                Spacer(Modifier.height(Spacing.md))
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            CoveButton(
                adm("common.save"), enabled = dirty.isNotEmpty() && !invalid, loading = saving,
                onClick = {
                    if (needsOwner) askPassword = true else {
                        saving = true
                        scope.launch { run(null).onFailure { toast(context, adminError(it.message)) }; saving = false }
                    }
                }
            )
            CoveButton(adm("admin.config.discard"), onClick = { draft.clear() }, variant = ButtonVariant.Ghost, enabled = dirty.isNotEmpty())
        }

        if (askPassword) {
            StepUpDialog(
                title = adm("admin.config.confirm_title"), description = adm("admin.config.confirm_description"),
                confirmLabel = adm("common.save"), onDismiss = { askPassword = false }
            ) { password, _ -> run(password) }
        }
    }
}

@Composable
private fun SettingEditor(setting: ConfigSetting, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    val label = admOr("admin.config.keys.${setting.key}", setting.key)
    val caption = listOfNotNull(
        if (setting.ownerOnly) adm("admin.config.owner_only") else null,
        if (setting.restartRequired) adm("admin.config.needs_restart") else null
    ).joinToString(" · ").ifEmpty { null }
    when (setting.type) {
        "bool" -> CoveSwitchRow(label, value == "true", caption = caption, enabled = enabled) { onChange(it.toString()) }
        "enum" -> FormField(label, hint = caption) {
            CoveChoiceList((setting.options ?: emptyList()).map { it to it }, selected = value, enabled = enabled) { onChange(it) }
        }
        "int" -> FormField(label, hint = caption ?: setting.range()) {
            CoveTextField(value, { onChange(it.filter(Char::isDigit)) }, enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        else -> FormField(label, hint = caption) {
            CoveTextField(value, onChange, enabled = enabled, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
        }
    }
}

private fun ConfigSetting.range(): String? = if (min != null && max != null) "$min – $max" else null

// ── Admins ──────────────────────────────────────────────────────────────────

private data class PendingAdminAction(val kind: String, val username: String)

/**
 * Who can open this panel. Everyone sees the list; only the owner can change it, and every change re-checks the
 * owner's password on the server.
 */
@Composable
private fun AdminsPanel(isOwner: Boolean, onRoleChanged: () -> Unit) {
    val app = CoveApp.instance
    val api = app.apiClient
    val context = LocalContext.current
    val c = CoveTheme.extendedColors
    val accounts = rememberLoader { api.adminAdmins() }
    var username by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<PendingAdminAction?>(null) }

    Text(adm("admin.admins.description"), color = c.textMuted, style = CoveType.label)
    Spacer(Modifier.height(Spacing.lg))
    accounts.Await { list ->
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            list.forEach { a: AdminAccount ->
                AdminCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.AdminPanelSettings, null, tint = c.textMuted, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.size(Spacing.md))
                        Column(Modifier.weight(1f)) {
                            Text(a.username, color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium)
                            Text(adm("admin.roles.${a.role}"), color = if (a.role == "owner") MaterialTheme.colorScheme.primary else c.textMuted, style = CoveType.caption)
                        }
                        if (isOwner && a.role == "admin") {
                            CoveButton(adm("admin.admins.make_owner"), { pending = PendingAdminAction("transfer", a.username) }, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
                            CoveIconButton(Icons.Outlined.Delete, adm("admin.admins.remove"), { pending = PendingAdminAction("revoke", a.username) }, variant = IconButtonVariant.Destructive)
                        }
                    }
                }
            }
        }
    }

    if (isOwner) {
        Spacer(Modifier.height(Spacing.xl))
        FormField(adm("admin.admins.add")) {
            CoveTextField(username, { username = it }, placeholder = adm("admin.admins.username_placeholder"), keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
        }
        Spacer(Modifier.height(Spacing.md))
        CoveButton(adm("admin.admins.grant"), { pending = PendingAdminAction("grant", username.trim()) }, enabled = username.isNotBlank())
    }

    pending?.let { p ->
        StepUpDialog(
            title = adm("admin.admins.confirm_${p.kind}_title", "username" to p.username),
            description = adm("admin.admins.confirm_${p.kind}_description", "username" to p.username),
            confirmLabel = adm("common.confirm"), destructive = p.kind != "grant",
            phrase = if (p.kind == "transfer") "TRANSFER" else null,
            onDismiss = { pending = null }
        ) { password, _ ->
            when (p.kind) {
                "grant" -> api.adminGrant(p.username, password)
                "revoke" -> api.adminRevoke(p.username, password)
                else -> api.adminTransferOwner(p.username, password)
            }.onSuccess {
                toast(context, adm("admin.admins.done_${p.kind}", "username" to p.username))
                if (p.kind == "grant") username = ""
                accounts.reload()
                // The server moved the owner role; refresh ours so the Data tab and owner-only controls follow.
                if (p.kind == "transfer") api.getMe().onSuccess { onRoleChanged() }
            }
        }
    }
}

// ── Data (owner only) ───────────────────────────────────────────────────────

private enum class DataAction { Backup, Reset, Delete }

/** Owner-only: encrypted backup, reset, and deleting the whole server. */
@Composable
private fun DataPanel(onLogout: () -> Unit) {
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = CoveTheme.extendedColors
    val overview = rememberLoader { api.adminOverview() }
    val domain = overview.data?.domain.orEmpty()
    var action by remember { mutableStateOf<DataAction?>(null) }
    var backup by remember { mutableStateOf<ByteArray?>(null) }

    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri: Uri? ->
        val bytes = backup
        backup = null
        if (uri == null || bytes == null) return@rememberLauncherForActivityResult
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("no stream") }.isSuccess
            }
            toast(context, if (ok) adm("admin.data.backup_done") else adm("admin.errors.backup_failed"))
        }
    }

    SectionHeader(adm("admin.data.backup_title"))
    Text(adm("admin.data.backup"), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium)
    Text(adm("admin.data.backup_hint"), color = c.textMuted, style = CoveType.caption)
    Spacer(Modifier.height(Spacing.md))
    CoveButton(adm("admin.data.backup_button"), { action = DataAction.Backup }, variant = ButtonVariant.Outline)

    Spacer(Modifier.height(Spacing.xl))
    Column(Modifier.fillMaxWidth().clip(CoveShapes.md).border(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.4f), CoveShapes.md).padding(Spacing.lg)) {
        Text(adm("admin.data.danger_title"), color = MaterialTheme.colorScheme.error, style = CoveType.label, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(Spacing.md))
        Text(adm("admin.data.reset"), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium)
        Text(adm("admin.data.reset_hint"), color = c.textMuted, style = CoveType.caption)
        Spacer(Modifier.height(Spacing.sm))
        CoveButton(adm("admin.data.reset_button"), { action = DataAction.Reset }, variant = ButtonVariant.Destructive)
        Spacer(Modifier.height(Spacing.lg))
        Text(adm("admin.data.delete"), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium)
        Text(adm("admin.data.delete_hint"), color = c.textMuted, style = CoveType.caption)
        Spacer(Modifier.height(Spacing.sm))
        CoveButton(adm("admin.data.delete_button"), { action = DataAction.Delete }, variant = ButtonVariant.Destructive, enabled = domain.isNotEmpty())
    }

    val dismiss = { action = null }
    when (action) {
        DataAction.Backup -> StepUpDialog(
            adm("admin.data.backup_title"), adm("admin.data.backup_confirm"), adm("admin.data.backup_button"),
            onDismiss = dismiss, needsPassphrase = true
        ) { password, passphrase ->
            api.adminBackup(password, passphrase).map {
                backup = it
                save.launch("cove-${java.time.LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd-HH-mm-ss"))}.cove-backup")
            }
        }
        DataAction.Reset -> StepUpDialog(
            adm("admin.data.reset"), adm("admin.data.reset_confirm"), adm("admin.data.reset_button"),
            onDismiss = dismiss, destructive = true, phrase = "RESET"
        ) { password, _ ->
            api.adminReset(password, "RESET").onSuccess { toast(context, adm("admin.data.reset_done")) }
        }
        DataAction.Delete -> StepUpDialog(
            adm("admin.data.delete"), adm("admin.data.delete_confirm"), adm("admin.data.delete_button"),
            onDismiss = dismiss, destructive = true, phrase = domain
        ) { password, _ ->
            api.adminDeleteServer(password, domain).onSuccess { onLogout() }
        }
        null -> Unit
    }
}
