package com.cove.chat.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.bots.Bot
import com.cove.chat.bots.BotLogic
import com.cove.chat.bots.BotScopes
import com.cove.chat.bots.ChannelBot
import com.cove.chat.bots.ChannelCommand
import com.cove.chat.bots.CreateBotRequest
import com.cove.chat.bots.UpdateBotRequest
import com.cove.chat.data.model.Channel
import com.cove.chat.data.remote.ApiStandard
import com.cove.chat.ui.components.BotBadge
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveConfirmDialog
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.CoveSwitchRow
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.EmptyState
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the owner is shown once: a bot token and/or a webhook signing secret. They cannot be shown again. */
private data class Secrets(val token: String?, val webhookSecret: String?)

private fun copyToClipboard(context: Context, label: String, value: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText(label, value))
    I18nToast.make(context, "Copied", Toast.LENGTH_SHORT).show()
}

private fun statusLine(b: Bot): String = listOf(
    if (b.disabled) "Disabled" else if (b.online) "Online" else "Offline",
    if (b.public) "Public" else "Private",
    if (b.installCount == 1) "In 1 channel" else "In ${b.installCount} channels"
).joinToString(" · ")

/**
 * Settings > Bots: create and manage the bots you own (server admins can list every bot on the server). Who may create
 * bots is a server setting; when it excludes you the button is disabled and the reason is shown. Hidden entirely on
 * servers without the `bots` capability (see SettingsScreen).
 */
@Composable
fun BotsSettings() {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val api = app.apiClient
    val context = LocalContext.current
    val isAdmin = !app.preferencesManager.serverRole.isNullOrBlank()
    var all by remember { mutableStateOf(false) }
    var page by remember { mutableStateOf<com.cove.chat.bots.BotPage?>(null) }
    var loading by remember { mutableStateOf(true) }
    var creating by remember { mutableStateOf(false) }
    var managing by remember { mutableStateOf<Bot?>(null) }
    var secrets by remember { mutableStateOf<Secrets?>(null) }
    var tick by remember { mutableStateOf(0) }

    LaunchedEffect(all, tick) {
        loading = true
        api.getBots(all && isAdmin).onSuccess { page = it }.onFailure { I18nToast.make(context, it.message ?: "Couldn't load bots.", Toast.LENGTH_SHORT).show() }
        loading = false
    }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text(
            "Bots are programs that read and write chat messages for you. Create one, copy its token and run it anywhere.",
            color = c.textMuted, fontSize = CoveType.label.fontSize
        )
        val p = page
        if (p != null && !p.enabled) Text("Bots are switched off on this server.", color = c.textMuted, fontSize = CoveType.label.fontSize)
        CoveButton("Create bot", onClick = { creating = true }, enabled = p?.canCreate == true)
        if (p != null && p.enabled && !p.canCreate) {
            Text(
                if (p.maxPerUser > 0 && p.items.size >= p.maxPerUser && !all) "You have reached the limit of ${p.maxPerUser} bots." else "Only server admins can create bots on this server.",
                color = c.textMuted, fontSize = CoveType.caption.fontSize
            )
        }
        if (isAdmin) CoveSwitchRow("Show every bot on the server", all, onChange = { all = it })
        if (loading && p == null) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
        if (p != null && p.items.isEmpty()) EmptyState(icon = Icons.Outlined.SmartToy, title = "You have no bots yet.")
        p?.items?.forEach { bot ->
            CoveListRow(
                title = bot.username,
                subtitle = statusLine(bot),
                titleBadge = { BotBadge() },
                onClick = { managing = bot },
                contentPadding = PaddingValues(vertical = Spacing.sm),
                leading = { UserAvatar(bot.id, size = 40.dp, avatarId = bot.avatarId) }
            )
        }
    }

    if (creating) CreateBotDialog(onDismiss = { creating = false }, onCreated = { res ->
        creating = false
        tick++
        secrets = Secrets(res.token, res.webhookSecret)
    })
    managing?.let { bot ->
        ManageBotDialog(bot, onDismiss = { managing = null }, onChanged = { tick++ }, onSecrets = { secrets = it })
    }
    secrets?.let { s -> SecretsDialog(s, onDone = { secrets = null }) }
}

@Composable
private fun CreateBotDialog(onDismiss: () -> Unit, onCreated: (com.cove.chat.bots.CreateBotResponse) -> Unit) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isPublic by remember { mutableStateOf(false) }
    var webhook by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val nameOk = BotLogic.isValidBotName(name.trim())

    CoveDialog(
        onDismiss, title = "Create a bot",
        footer = {
            CoveButton("Create", enabled = nameOk && !busy, loading = busy, onClick = {
                busy = true; error = null
                scope.launch {
                    api.createBot(CreateBotRequest(name.trim(), description.trim().ifBlank { null }, isPublic.takeIf { it }, webhook.trim().ifBlank { null }))
                        .onSuccess(onCreated).onFailure { error = it.message ?: "Couldn't create the bot." }
                    busy = false
                }
            })
        }
    ) {
        Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()).padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text("Bot name *", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
            CoveTextField(name, { name = it.lowercase() }, placeholder = "pingbot", isError = name.isNotEmpty() && !nameOk)
            Text("2-32 lowercase letters, digits, _ . or -", color = c.textMuted, fontSize = CoveType.caption.fontSize)
            Text("Description", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
            CoveTextField(description, { description = it.take(400) }, singleLine = false)
            CoveSwitchRow("Public", isPublic, caption = "Public bots can be found and added to channels by any channel admin.", onChange = { isPublic = it })
            Text("Webhook URL", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
            CoveTextField(webhook, { webhook = it.trim() }, placeholder = "https://")
            Text("Optional. Events are POSTed here (https only) when the bot is not connected to the gateway.", color = c.textMuted, fontSize = CoveType.caption.fontSize)
            error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize) }
        }
    }
}

@Composable
private fun SecretsDialog(s: Secrets, onDone: () -> Unit) {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    // Closes only through the button, so the one-time secret is not lost by a stray tap outside.
    CoveDialog(
        onDismiss = {}, title = "Save your bot token", showClose = false,
        footer = { CoveButton("I have saved it", onClick = onDone) }
    ) {
        Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()).padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(
                "This is the only time it is shown. Anyone with the token can act as the bot, so keep it private. If it leaks, rotate it.",
                color = c.warning, fontSize = CoveType.label.fontSize
            )
            s.token?.let { SecretBlock("Bot token", it, context) }
            s.webhookSecret?.let { SecretBlock("Webhook signing secret", it, context) }
        }
    }
}

@Composable
private fun SecretBlock(label: String, value: String, context: Context) {
    val c = CoveTheme.extendedColors
    Text(label, color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    SelectionContainer {
        Text(
            value, color = c.textPrimary, fontSize = CoveType.label.fontSize, fontFamily = FontFamily.Monospace,
            modifier = Modifier.fillMaxWidth().clip(CoveShapes.md).background(c.popover).padding(Spacing.md)
        )
    }
    CoveButton("Copy", variant = ButtonVariant.Secondary, size = ButtonSize.Sm, onClick = { copyToClipboard(context, label, value) })
}

@Composable
private fun ManageBotDialog(bot: Bot, onDismiss: () -> Unit, onChanged: () -> Unit, onSecrets: (Secrets) -> Unit) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var description by remember { mutableStateOf(bot.description) }
    var webhook by remember { mutableStateOf(bot.webhookUrl.orEmpty()) }
    var isPublic by remember { mutableStateOf(bot.public) }
    var enabled by remember { mutableStateOf(!bot.disabled) }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmRotate by remember { mutableStateOf(false) }

    fun toast(m: String) = I18nToast.make(context, m, Toast.LENGTH_SHORT).show()

    CoveDialog(
        onDismiss, title = "Manage ${bot.username}",
        footer = {
            CoveButton("Save", loading = busy, onClick = {
                busy = true
                scope.launch {
                    val changedHook = webhook.trim() != bot.webhookUrl.orEmpty()
                    api.updateBot(bot.id, UpdateBotRequest(description, isPublic, !enabled, if (changedHook) webhook.trim() else null))
                        .onSuccess { r ->
                            toast("Bot updated"); onChanged()
                            r.webhookSecret?.let { onSecrets(Secrets(null, it)) }
                            onDismiss()
                        }.onFailure { toast(it.message ?: "Couldn't update the bot.") }
                    busy = false
                }
            })
        }
    ) {
        Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text("Description", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
            CoveTextField(description, { description = it.take(400) }, singleLine = false)
            CoveSwitchRow("Enabled", enabled, onChange = { enabled = it })
            CoveSwitchRow("Public (listed for channel admins)", isPublic, onChange = { isPublic = it })
            Text("Webhook URL", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
            CoveTextField(webhook, { webhook = it.trim() }, placeholder = "https://")
            if (webhook.isBlank()) Text("No webhook. The bot must connect to the gateway.", color = c.textMuted, fontSize = CoveType.caption.fontSize)
            if (!bot.webhookUrl.isNullOrBlank()) {
                CoveButton("New signing secret", variant = ButtonVariant.Secondary, size = ButtonSize.Sm, onClick = {
                    scope.launch {
                        api.updateBot(bot.id, UpdateBotRequest(rotateWebhookSecret = true))
                            .onSuccess { r -> r.webhookSecret?.let { onSecrets(Secrets(null, it)) } }
                            .onFailure { toast(it.message ?: "Couldn't update the bot.") }
                    }
                })
            }
            CoveButton("Rotate token", variant = ButtonVariant.Secondary, onClick = { confirmRotate = true })
            Text("Issues a new token and disconnects the bot immediately.", color = c.textMuted, fontSize = CoveType.caption.fontSize)
            CoveButton("Delete bot", variant = ButtonVariant.Destructive, onClick = { confirmDelete = true })
        }
    }
    if (confirmRotate) CoveConfirmDialog(
        title = "Rotate token", message = "Issues a new token and disconnects the bot immediately.", confirmLabel = "Rotate token", destructive = true,
        onDismiss = { confirmRotate = false },
        onConfirm = {
            confirmRotate = false
            scope.launch {
                api.rotateBotToken(bot.id).onSuccess { onSecrets(Secrets(it.token, null)); onChanged() }
                    .onFailure { toast(it.message ?: "Couldn't update the bot.") }
            }
        }
    )
    if (confirmDelete) CoveConfirmDialog(
        title = "Delete bot", message = "Delete ${bot.username}? It is removed from every channel and its token stops working. Its past messages stay.",
        confirmLabel = "Delete bot", destructive = true, onDismiss = { confirmDelete = false },
        onConfirm = {
            confirmDelete = false
            scope.launch {
                api.deleteBot(bot.id).onSuccess { toast("Bot deleted"); onChanged(); onDismiss() }.onFailure { toast(it.message ?: "Couldn't delete the bot.") }
            }
        }
    )
}

private fun scopeTitle(scope: String) = when (scope) {
    BotScopes.SEND -> "Send messages"
    BotScopes.READ -> "Read all messages"
    else -> "See members"
}

private fun scopeHint(scope: String) = when (scope) {
    BotScopes.SEND -> "Post, edit and delete its own messages; show buttons and the action menu."
    BotScopes.READ -> "See every message in the channel. Without it the bot only sees messages that mention or reply to it, and commands."
    else -> "List who is in the channel and get told when someone joins or leaves."
}

/**
 * The "Bots" section of the channel settings (channel admins): installed bots with their permissions and commands, a
 * remove button, and the add flow with the permission consent text. Hidden on servers without the `bots` capability.
 */
@Composable
fun ChannelBotsSection(channel: Channel, isAdmin: Boolean) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var supported by remember { mutableStateOf(false) }
    var installed by remember { mutableStateOf<List<ChannelBot>>(emptyList()) }
    var commands by remember { mutableStateOf<List<ChannelCommand>>(emptyList()) }
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Bot?>(null) }
    var tick by remember { mutableStateOf(0) }

    LaunchedEffect(channel.id, tick) {
        supported = ApiStandard.supportsBots(api.getVersion().getOrNull()?.capabilities)
        if (supported) {
            api.getChannelBots(channel.id).onSuccess { installed = it }
            api.getChannelCommands(channel.id).onSuccess { commands = it }
        }
    }
    if (!supported) return

    Text("Bots", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    if (installed.isEmpty()) Text("No bots in this channel.", color = c.textMuted, fontSize = CoveType.label.fontSize)
    installed.forEach { cb ->
        val cmds = commands.filter { it.botId == cb.bot.id }
        CoveListRow(
            title = cb.bot.username,
            subtitle = (cb.scopes.map(::scopeTitle).joinToString(" · ")) + if (cmds.isNotEmpty()) "\n" + cmds.joinToString(" ") { "/${it.name}" } else "",
            titleBadge = { BotBadge() },
            contentPadding = PaddingValues(vertical = Spacing.xs),
            leading = { UserAvatar(cb.bot.id, size = 32.dp, avatarId = cb.bot.avatarId) },
            trailing = if (isAdmin) ({ CoveIconButton(Icons.Outlined.Close, "Remove ${cb.bot.username}", { removing = cb.bot }, size = 44.dp, iconSize = 18.dp) }) else null
        )
    }
    if (isAdmin) CoveButton("Add a bot", variant = ButtonVariant.Secondary, size = ButtonSize.Sm, onClick = { adding = true })

    if (adding) InstallBotDialog(channel.id, onDismiss = { adding = false }, onInstalled = {
        adding = false; tick++
        I18nToast.make(context, "Bot added", Toast.LENGTH_SHORT).show()
    })
    removing?.let { bot ->
        CoveConfirmDialog(
            title = "Remove ${bot.username}", message = "Remove ${bot.username} from this channel?", confirmLabel = "Remove", destructive = true,
            onDismiss = { removing = null },
            onConfirm = {
                removing = null
                scope.launch {
                    api.uninstallBot(channel.id, bot.id).onSuccess { tick++; I18nToast.make(context, "Bot removed", Toast.LENGTH_SHORT).show() }
                        .onFailure { I18nToast.make(context, it.message ?: "Couldn't change the bot's installation.", Toast.LENGTH_SHORT).show() }
                }
            }
        )
    }
}

@Composable
private fun InstallBotDialog(channelId: String, onDismiss: () -> Unit, onInstalled: () -> Unit) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var mine by remember { mutableStateOf<List<Bot>>(emptyList()) }
    var found by remember { mutableStateOf<List<Bot>>(emptyList()) }
    var picked by remember { mutableStateOf<Bot?>(null) }
    val scopes = remember { mutableStateListOf(BotScopes.SEND) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { api.getBots().onSuccess { mine = it.items.filter { b -> !b.disabled } } }
    LaunchedEffect(query) {
        delay(300)
        api.discoverBots(query.trim()).onSuccess { found = it.items }
    }
    val mineIds = mine.map { it.id }.toSet()
    val list = (mine + found.filter { it.id !in mineIds }).filter { query.isBlank() || it.username.contains(query.trim().lowercase()) }

    CoveDialog(
        onDismiss, title = "Add a bot to this channel",
        footer = if (picked != null) ({
            CoveButton("Add bot", enabled = scopes.isNotEmpty() && !busy, loading = busy, onClick = {
                val bot = picked ?: return@CoveButton
                busy = true; error = null
                scope.launch {
                    api.installBot(channelId, bot.id, scopes.toList()).onSuccess { onInstalled() }.onFailure { error = it.message ?: "Couldn't change the bot's installation." }
                    busy = false
                }
            })
        }) else null
    ) {
        Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            val bot = picked
            if (bot == null) {
                CoveTextField(query, { query = it }, placeholder = "Search public bots")
                list.forEach { b ->
                    CoveListRow(
                        title = b.username, subtitle = b.description.ifBlank { null }, titleBadge = { BotBadge() },
                        onClick = { picked = b }, contentPadding = PaddingValues(vertical = Spacing.xs),
                        leading = { UserAvatar(b.id, size = 32.dp, avatarId = b.avatarId) }
                    )
                }
                if (list.isEmpty()) Text("No bots found.", color = c.textMuted, fontSize = CoveType.label.fontSize)
            } else {
                CoveListRow(
                    title = bot.username, subtitle = bot.description.ifBlank { null }, titleBadge = { BotBadge() },
                    contentPadding = PaddingValues(vertical = Spacing.xs), leading = { UserAvatar(bot.id, size = 32.dp, avatarId = bot.avatarId) },
                    trailing = { CoveIconButton(Icons.Outlined.Close, "Choose another bot", { picked = null }, size = 44.dp, iconSize = 18.dp) }
                )
                Text("Permissions", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
                BotScopes.all.forEach { s ->
                    CoveSwitchRow(scopeTitle(s), s in scopes, caption = scopeHint(s), onChange = { on -> if (on) { if (s !in scopes) scopes.add(s) } else scopes.remove(s) })
                }
                Text(
                    "The bot's owner (and the server their bot runs on) will receive, as plain text, everything these permissions allow. Only add bots you trust. Bots are never admins.",
                    color = c.textMuted, fontSize = CoveType.caption.fontSize, modifier = Modifier.clip(CoveShapes.md).background(c.popover).padding(Spacing.md)
                )
                error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize) }
            }
        }
    }
}
