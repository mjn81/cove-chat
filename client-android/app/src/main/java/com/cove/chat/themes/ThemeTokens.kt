package com.cove.chat.themes

/** Token allow-list, token validation and the readability guard (port of `themes/utils/tokens.ts`). */
object ThemeTokens {
    /** Tokens every theme must define. */
    val CORE = listOf(
        "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
        "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
        "accent", "accent-foreground", "destructive", "destructive-foreground", "border", "input", "ring",
    )

    /** Tokens a theme may omit; they fall back to the Cove value of the same mode. */
    val OPTIONAL = listOf(
        "mention-background", "mention-foreground", "mention-border", "success", "success-foreground",
        "warning", "warning-foreground", "overlay", "overlay-foreground",
    )

    val ALL: List<String> = CORE + OPTIONAL
    private val ALLOWED = ALL.toSet()

    /** Text/surface pairs of the readability guard. */
    val READABILITY_PAIRS = listOf(
        "foreground" to "background", "card-foreground" to "card", "popover-foreground" to "popover",
        "primary-foreground" to "primary", "secondary-foreground" to "secondary", "muted-foreground" to "background",
        "muted-foreground" to "muted", "accent-foreground" to "accent", "destructive-foreground" to "destructive",
    )

    /** Below this a pair is refused. */
    const val MIN_CONTRAST_HARD = 3.0
    /** Below this a pair is accepted with a warning (WCAG AA). */
    const val MIN_CONTRAST_AA = 4.5

    data class Sanitized(val tokens: Map<String, String>, val errors: List<ThemeIssue>, val warnings: List<ThemeIssue>)

    /**
     * Validates an untrusted token map: keeps allow-listed names with valid values (normalised, clamped), drops unknown
     * names, and reports missing core tokens. [input] is null when the JSON value was not an object.
     */
    fun sanitize(input: Map<String, Any?>?): Sanitized {
        val tokens = linkedMapOf<String, String>()
        val errors = mutableListOf<ThemeIssue>()
        val warnings = mutableListOf<ThemeIssue>()
        if (input == null) return Sanitized(tokens, listOf(ThemeIssue("invalid_tokens")), warnings)
        for ((name, value) in input) {
            if (name !in ALLOWED) { warnings += ThemeIssue("unknown_token", name.take(40)); continue }
            val parsed = ThemeColor.parse(value as? String)
            if (parsed == null) { errors += ThemeIssue("invalid_token_value", name); continue }
            if (parsed.clamped) warnings += ThemeIssue("token_clamped", name)
            tokens[name] = parsed.value
        }
        for (name in CORE) {
            if (name !in tokens && errors.none { it.detail == name }) errors += ThemeIssue("missing_token", name)
        }
        return Sanitized(tokens, errors, warnings)
    }

    /** Readability guard: refuses sets whose text barely differs from its surface, flags mediocre ones. */
    fun checkReadability(tokens: Map<String, String>): Pair<List<ThemeIssue>, List<ThemeIssue>> {
        val errors = mutableListOf<ThemeIssue>()
        val warnings = mutableListOf<ThemeIssue>()
        for ((fg, bg) in READABILITY_PAIRS) {
            val a = tokens[fg] ?: continue
            val b = tokens[bg] ?: continue
            val ratio = ThemeColor.contrast(a, b)
            if (ratio < MIN_CONTRAST_HARD) errors += ThemeIssue("low_contrast", "$fg/$bg")
            else if (ratio < MIN_CONTRAST_AA) warnings += ThemeIssue("low_contrast", "$fg/$bg")
        }
        val p = tokens["primary"]
        val bg = tokens["background"]
        if (p != null && bg != null && ThemeColor.contrast(p, bg) < 1.5) warnings += ThemeIssue("low_contrast", "primary/background")
        return errors to warnings
    }

    /** Fills the tokens a theme left out from [fallback] (the Cove palette of the same mode). */
    fun complete(tokens: Map<String, String>, fallback: Map<String, String>): Map<String, String> {
        val out = LinkedHashMap(fallback)
        for (name in ALL) tokens[name]?.let { out[name] = it }
        return out
    }
}
