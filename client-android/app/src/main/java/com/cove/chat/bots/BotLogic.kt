package com.cove.chat.bots

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.net.URI

/**
 * Pure logic of the Bot API on Android (mirrors client-web `domains/bots/utils`): parsing `bot` message bodies,
 * slash-command autocomplete and parsing, and the action-menu state rules. No Android classes, so it runs on the JVM.
 */
object BotLogic {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val styles = setOf("primary", "secondary", "danger")

    // ── Bot messages ─────────────────────────────────────────────────────────────────────────────────────────────

    /** Only http(s) links are ever opened from a button; anything else (javascript:, data:) is refused. */
    fun isSafeButtonUrl(raw: String): Boolean {
        if (raw.isBlank() || raw.length > 2048) return false
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return false
        val scheme = uri.scheme?.lowercase()
        return (scheme == "https" || scheme == "http") && !uri.host.isNullOrEmpty() && uri.userInfo == null
    }

    private fun parseButton(e: JsonElement): BotButton? {
        val o = e as? JsonObject ?: return null
        val label = (o["label"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        if (label.isEmpty()) return null
        val customId = (o["custom_id"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }
        val url = (o["url"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }
        if ((customId == null) == (url == null)) return null
        if (url != null && !isSafeButtonUrl(url)) return null
        val style = (o["style"] as? JsonPrimitive)?.contentOrNull?.takeIf { it in styles } ?: "secondary"
        val disabled = (o["disabled"] as? JsonPrimitive)?.booleanOrNull == true
        return BotButton(label, style, customId, url, disabled)
    }

    /**
     * Parses the decrypted body of a `bot` message. This is the trust boundary on the client: unknown fields are
     * ignored, malformed buttons dropped, unsafe links removed, and the grid capped at 5x5 like the server.
     * Returns null when the text is not a bot message body at all.
     */
    fun parseBotMessage(text: String?): BotMessageBody? {
        if (text.isNullOrBlank()) return null
        val root = runCatching { json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return null
        val body = (root["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val rows = ((root["buttons"] as? JsonArray) ?: JsonArray(emptyList())).take(5).mapNotNull { row ->
            (row as? JsonArray)?.take(5)?.mapNotNull(::parseButton)?.takeIf { it.isNotEmpty() }
        }
        return BotMessageBody(body, rows)
    }

    /** Plain text of a bot message for previews and quotes. */
    fun preview(text: String?): String = parseBotMessage(text)?.text.orEmpty()

    private val botName = Regex("^[a-z0-9][a-z0-9_.-]{1,31}$")

    /** Mirrors the server rule for bot names (the server is the authority; this only saves a round trip). */
    fun isValidBotName(name: String): Boolean = botName.matches(name)

    // ── Slash commands ───────────────────────────────────────────────────────────────────────────────────────────

    const val MAX_SUGGESTIONS = 8

    /** Commands whose name starts with, then merely contains, [query], in that order. */
    fun filterCommands(commands: List<ChannelCommand>, query: String): List<ChannelCommand> {
        val q = query.lowercase()
        val starts = commands.filter { it.name.startsWith(q) }
        val contains = commands.filter { !it.name.startsWith(q) && it.name.contains(q) }
        return (starts + contains).take(MAX_SUGGESTIONS)
    }

    private val slashTyping = Regex("^/([a-zA-Z0-9_-]*)$")

    /** The name typed after a leading `/` while the user is still typing it (no space yet); null otherwise. */
    fun slashQuery(text: String): String? = slashTyping.matchEntire(text)?.groupValues?.get(1)

    /** Splits on spaces keeping "double" and 'single' quoted parts together. */
    fun tokenizeArgs(rest: String): List<String> {
        val tokens = mutableListOf<String>()
        val cur = StringBuilder()
        var quote: Char? = null
        var started = false
        for (ch in rest) {
            when {
                quote != null -> if (ch == quote) quote = null else cur.append(ch)
                ch == '"' || ch == '\'' -> { quote = ch; started = true }
                ch.isWhitespace() -> { if (started || cur.isNotEmpty()) tokens += cur.toString(); cur.clear(); started = false }
                else -> { cur.append(ch); started = true }
            }
        }
        if (started || cur.isNotEmpty()) tokens += cur.toString()
        return tokens
    }

    /** Result of [parseSlashInput]. */
    sealed interface Parsed {
        /** Not a known command: send the text as an ordinary message. */
        object None : Parsed
        data class Ok(val command: ChannelCommand, val options: Map<String, JsonElement>) : Parsed
        data class Error(val command: ChannelCommand, val reason: Reason, val option: String) : Parsed
    }

    enum class Reason { Missing, Invalid, UnknownOption, NotAChoice }

    private fun coerce(option: CommandOption, raw: String, resolveUser: ((String) -> String?)?): JsonElement? = when (option.type) {
        "integer" -> if (Regex("^-?\\d+$").matches(raw)) JsonPrimitive(raw.toLong()) else null
        "number" -> raw.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { JsonPrimitive(it) }
        "boolean" -> when (raw.lowercase()) {
            "true", "yes", "on", "1" -> JsonPrimitive(true)
            "false", "no", "off", "0" -> JsonPrimitive(false)
            else -> null
        }
        "user" -> (resolveUser?.invoke(raw.removePrefix("@")) ?: if (resolveUser == null) raw else null)?.let { JsonPrimitive(it) }
        else -> JsonPrimitive(raw)
    }

    private fun asText(e: JsonElement): String = (e as? JsonPrimitive)?.let { p ->
        p.longOrNull?.toString() ?: p.doubleOrNull?.let { d -> if (d == Math.floor(d)) d.toLong().toString() else d.toString() } ?: p.content
    } ?: e.toString()

    private val slashCommand = Regex("^/([a-zA-Z0-9_-]+)(?:@([a-zA-Z0-9_.-]+))?(?:\\s+([\\s\\S]*))?$")

    /**
     * Parses `/name arg arg name:value ...` against the channel's commands: `option:value` pairs or positional values
     * in option order, `/name@bot` to pick a bot when two share a name. Unknown commands are [Parsed.None].
     */
    fun parseSlashInput(text: String, commands: List<ChannelCommand>, resolveUser: ((String) -> String?)? = null): Parsed {
        val m = slashCommand.matchEntire(text.trimEnd()) ?: return Parsed.None
        val name = m.groupValues[1].lowercase()
        val bot = m.groupValues[2].lowercase()
        val rest = m.groupValues[3]
        val command = commands.firstOrNull { it.name == name && (bot.isEmpty() || it.botUsername == bot) } ?: return Parsed.None
        val values = linkedMapOf<String, JsonElement>()
        var positional = 0
        for (token in tokenizeArgs(rest)) {
            val pair = Regex("^([a-zA-Z0-9_-]+):(.*)$").matchEntire(token)
            val named = pair?.let { p -> command.options.firstOrNull { it.name == p.groupValues[1] } }
            val option: CommandOption
            val raw: String
            if (named != null && pair != null) {
                option = named; raw = pair.groupValues[2]
            } else {
                while (positional < command.options.size && command.options[positional].name in values) positional++
                option = command.options.getOrNull(positional) ?: return Parsed.Error(command, Reason.UnknownOption, token)
                raw = token
            }
            val value = coerce(option, raw, resolveUser) ?: return Parsed.Error(command, Reason.Invalid, option.name)
            if (option.choices.isNotEmpty() && option.choices.none { it.value == asText(value) }) {
                return Parsed.Error(command, Reason.NotAChoice, option.name)
            }
            values[option.name] = value
        }
        command.options.firstOrNull { it.required && it.name !in values }?.let { return Parsed.Error(command, Reason.Missing, it.name) }
        return Parsed.Ok(command, values)
    }

    /** One-line usage such as `/roll <sides> [note]`. */
    fun usageLine(c: ChannelCommand): String =
        (listOf("/${c.name}") + c.options.map { if (it.required) "<${it.name}>" else "[${it.name}]" }).joinToString(" ")

    /** The text to put in the composer when [c] is picked; `/name@bot` when two bots offer the same name. */
    fun commandInsertText(c: ChannelCommand, all: List<ChannelCommand>): String {
        val clash = all.any { it.name == c.name && it.botId != c.botId }
        return "/${c.name}${if (clash) "@${c.botUsername}" else ""} "
    }

    // ── Action menu (reply keyboard) ─────────────────────────────────────────────────────────────────────────────

    /** The user's choice for the active menu of a channel. */
    enum class KeyboardMode { Menu, Typing }

    /** What the composer renders: the grid replaces the input ([showMenu]) and/or a small toggle brings it back. */
    data class KeyboardView(val showMenu: Boolean, val showToggle: Boolean)

    /** Identity of a keyboard, so a changed menu is a new menu (it reappears after the user switched to typing). */
    fun keyboardSignature(k: BotKeyboard): String =
        k.botId + "|" + k.rows.joinToString(";") { row -> row.joinToString(",") { "${it.label}:${it.customId}" } }

    /** The first keyboard when several bots set one (the server keeps one per bot, in a stable order). */
    fun pickActiveKeyboard(keyboards: List<BotKeyboard>): BotKeyboard? = keyboards.firstOrNull { it.rows.isNotEmpty() }

    /**
     * A new keyboard opens as the menu; the user can switch to typing; only a persistent keyboard keeps a toggle to
     * bring the menu back, the others stay closed until the bot sends a different one. A one-time keyboard is closed
     * after a press by setting [KeyboardMode.Typing] (see [modeAfterPress]).
     */
    fun keyboardView(keyboard: BotKeyboard?, mode: KeyboardMode?): KeyboardView {
        if (keyboard == null) return KeyboardView(showMenu = false, showToggle = false)
        val open = mode != KeyboardMode.Typing
        return KeyboardView(showMenu = open, showToggle = !open && keyboard.persistent)
    }

    /** The mode after a key press: one-time keyboards close, others stay as they were. */
    fun modeAfterPress(keyboard: BotKeyboard, current: KeyboardMode?): KeyboardMode? =
        if (keyboard.oneTime) KeyboardMode.Typing else current

    /** Applies a `keyboard_update` to the channel's list: replaces that bot's keyboard, or removes it when null. */
    fun applyKeyboardUpdate(current: List<BotKeyboard>, update: KeyboardUpdate): List<BotKeyboard> {
        val others = current.filter { it.botId != update.botId }
        return update.keyboard?.let { others + it } ?: others
    }

    /** `messages.send` -> `messages_send`, for translation keys. */
    fun scopeLabelKey(scope: String): String = scope.replace('.', '_')
}
