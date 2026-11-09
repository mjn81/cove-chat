package com.cove.chat.themes

/** Light or dark appearance. */
enum class ThemeMode { Dark, Light;
    val wire: String get() = if (this == Dark) "dark" else "light"
    companion object { fun fromWire(s: String?): ThemeMode? = when (s) { "dark" -> Dark; "light" -> Light; else -> null } }
}

/** Display name per UI language; `en` is always present. */
data class LocalizedName(val en: String, val fa: String? = null, val ar: String? = null) {
    /** The name for UI language code [lang] ("en", "fa", "ar"), falling back to English. */
    fun forLanguage(lang: String): String = when (lang) { "fa" -> fa; "ar" -> ar; else -> null } ?: en
}

/** The built-in chat doodle patterns; same ids as the web client and [com.cove.chat.ui.components.ChatBackgroundIds]. */
val ChatPatternIds = listOf("animals", "space", "games", "sweets", "travel", "nature", "food", "music", "tech", "weather")

enum class ImageFit { Cover, Contain, Tile }

/** What sits behind the messages. Colours are canonical `H S% L%` triplets. */
sealed interface ChatBackground {
    data object None : ChatBackground
    data class Pattern(val pattern: String) : ChatBackground
    data class Color(val color: String) : ChatBackground
    data class Gradient(val from: String, val to: String, val angle: Int) : ChatBackground
    /** [asset] is the archive path (`assets/<name>`). */
    data class Image(val asset: String, val opacity: Float, val blur: Float, val fit: ImageFit) : ChatBackground
}

data class BubbleTint(val color: String, val strength: Float)

data class ThemeChat(val background: ChatBackground? = null, val bubbleTint: BubbleTint? = null)

/**
 * A validated theme. Built-ins and everything produced by [CoveThemeParser] have this shape; nothing else reaches the
 * runtime. `tokens` apply when the mode equals [base]; [light] is the light-mode variant of a dark-base theme.
 */
data class ThemeDefinition(
    val id: String,
    val name: LocalizedName,
    val base: ThemeMode,
    val tokens: Map<String, String>,
    val light: Map<String, String>? = null,
    val author: String? = null,
    val license: String? = null,
    val chat: ThemeChat? = null,
    val preview: String? = null,
)

/** The theme resolved for a mode: the mode actually shown and a complete token set. */
data class ResolvedTheme(val mode: ThemeMode, val tokens: Map<String, String>)

/** An image shipped in a `.covetheme` that already passed the type, size and dimension checks. */
class ThemeAsset(val mime: String, val bytes: ByteArray, val width: Int, val height: Int)

/** A problem found while validating theme data. [code] is stable (the UI maps it to text); [detail] names the item. */
data class ThemeIssue(val code: String, val detail: String? = null)
