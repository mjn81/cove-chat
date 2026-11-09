package com.cove.chat.themes

import com.cove.chat.themes.ThemeColor.hexToTriplet as h

/**
 * The eleven built-in themes, in the same tokens as `client-web/src/domains/themes/data/builtin-themes.ts`. The
 * palettes below are copied from that file, so a theme looks the same on every platform; a test checks the contrast
 * of every pair like the web test does.
 */
object BuiltinThemes {
    const val DEFAULT_ID = "cove"

    /** The few colours a variant needs; everything else is derived. */
    private class Palette(
        val background: String, val card: String, val popover: String, val foreground: String, val mutedForeground: String,
        val primary: String, val accent: String, val border: String, val destructive: String, val success: String, val warning: String,
    )

    private fun tokensFrom(p: Palette): Map<String, String> {
        val fg = h(p.foreground)
        val warn = h(p.warning)
        return linkedMapOf(
            "background" to h(p.background), "foreground" to fg,
            "card" to h(p.card), "card-foreground" to fg,
            "popover" to h(p.popover), "popover-foreground" to fg,
            "primary" to h(p.primary), "primary-foreground" to ThemeColor.pickForeground(h(p.primary)),
            "secondary" to h(p.card), "secondary-foreground" to fg,
            "muted" to h(p.card), "muted-foreground" to h(p.mutedForeground),
            "accent" to h(p.accent), "accent-foreground" to fg,
            "destructive" to h(p.destructive), "destructive-foreground" to ThemeColor.pickForeground(h(p.destructive)),
            "border" to h(p.border), "input" to h(p.border), "ring" to h(p.primary),
            "mention-background" to h(ThemeColor.mixHex(p.background, p.warning, 0.22)),
            "mention-foreground" to warn, "mention-border" to warn,
            "success" to h(p.success), "success-foreground" to ThemeColor.pickForeground(h(p.success)),
            "warning" to warn, "warning-foreground" to ThemeColor.pickForeground(warn),
            "overlay" to "0 0% 0%", "overlay-foreground" to "0 0% 100%",
        )
    }

    private fun pal(
        bg: String, card: String, pop: String, fg: String, muted: String, primary: String, accent: String, border: String,
        destructive: String, success: String, warning: String,
    ) = tokensFrom(Palette(bg, card, pop, fg, muted, primary, accent, border, destructive, success, warning))

    /** Cove dark: verbatim from `index.css` (the old hard-coded constants in `Color.kt` are these same colours). */
    val COVE_DARK: Map<String, String> = linkedMapOf(
        "background" to "20 6% 13%", "foreground" to "25 10% 90%", "card" to "20 6% 17%", "card-foreground" to "25 10% 90%",
        "popover" to "20 6% 10%", "popover-foreground" to "25 10% 90%", "primary" to "13 59% 63%", "primary-foreground" to "14 53% 11%",
        "secondary" to "20 6% 17%", "secondary-foreground" to "25 10% 90%", "muted" to "20 6% 17%", "muted-foreground" to "22 6% 66%",
        "accent" to "20 6% 22%", "accent-foreground" to "25 10% 90%", "destructive" to "355 83% 66%", "destructive-foreground" to "0 0% 100%",
        "border" to "20 6% 26%", "input" to "20 6% 26%", "ring" to "13 59% 63%",
        "mention-background" to "38 44% 16%", "mention-foreground" to "39 88% 68%", "mention-border" to "39 88% 68%",
        "success" to "148 48% 56%", "success-foreground" to "149 53% 9%", "warning" to "39 88% 68%", "warning-foreground" to "40 100% 8%",
        "overlay" to "0 0% 0%", "overlay-foreground" to "0 0% 100%",
    )

    /** Cove light: verbatim from `index.css`. */
    val COVE_LIGHT: Map<String, String> = linkedMapOf(
        "background" to "0 0% 100%", "foreground" to "24 19% 11%", "card" to "30 36% 96%", "card-foreground" to "24 19% 11%",
        "popover" to "0 0% 100%", "popover-foreground" to "24 19% 11%", "primary" to "12 51% 53%", "primary-foreground" to "0 0% 100%",
        "secondary" to "30 36% 96%", "secondary-foreground" to "24 19% 11%", "muted" to "30 36% 96%", "muted-foreground" to "26 9% 44%",
        "accent" to "30 30% 91%", "accent-foreground" to "24 19% 11%", "destructive" to "0 66% 53%", "destructive-foreground" to "0 0% 100%",
        "border" to "30 28% 87%", "input" to "30 28% 87%", "ring" to "12 51% 53%",
        "mention-background" to "45 100% 88%", "mention-foreground" to "39 100% 27%", "mention-border" to "39 100% 27%",
        "success" to "142 54% 39%", "success-foreground" to "0 0% 100%", "warning" to "39 100% 27%", "warning-foreground" to "0 0% 100%",
        "overlay" to "0 0% 0%", "overlay-foreground" to "0 0% 100%",
    )

    /** Cove's complete palettes by mode: the fallback for any token a theme omits. */
    fun cove(mode: ThemeMode): Map<String, String> = if (mode == ThemeMode.Dark) COVE_DARK else COVE_LIGHT

    private fun theme(
        id: String, en: String, fa: String, ar: String, base: ThemeMode, tokens: Map<String, String>, light: Map<String, String>? = null,
    ) = ThemeDefinition(id, LocalizedName(en, fa, ar), base, tokens, light, author = "Cove", license = "MIT")

    /** All built-in themes, default first. */
    val ALL: List<ThemeDefinition> = listOf(
        theme("cove", "Cove", "کاو", "كوف", ThemeMode.Dark, COVE_DARK, COVE_LIGHT),
        theme("violet-night", "Violet Night", "شب بنفش", "ليل بنفسجي", ThemeMode.Dark,
            pal("#313338", "#2b2d31", "#1e1f22", "#dbdee1", "#9da1a8", "#5865f2", "#3f4147", "#3f4147", "#f23f43", "#3ba55d", "#f0b232"),
            pal("#ffffff", "#f2f3f5", "#ffffff", "#313338", "#5c5f66", "#4752c4", "#e3e5e8", "#d7d9dc", "#c9302c", "#1f7a3f", "#8a5a00")),
        theme("skyline", "Skyline", "افق آبی", "أفق أزرق", ThemeMode.Dark,
            pal("#17212b", "#1e2c3a", "#0e1621", "#f5f5f5", "#8a9aa8", "#5eb5f7", "#2b3f52", "#2b3a49", "#ec7676", "#6cc07a", "#f0b25c"),
            pal("#ffffff", "#f1f3f4", "#ffffff", "#1b1f23", "#5a6670", "#1d72b8", "#e4e8ec", "#d8dde2", "#c0392b", "#1e7a3c", "#8a5a00")),
        theme("crimson", "Crimson", "ارغوانی سرخ", "قرمزي", ThemeMode.Dark,
            pal("#0f0f0f", "#181818", "#212121", "#f1f1f1", "#aaaaaa", "#ff4e45", "#272727", "#303030", "#ff6b6b", "#4cc38a", "#f5c04a"),
            pal("#ffffff", "#f2f2f2", "#ffffff", "#0f0f0f", "#5f5f5f", "#cc0000", "#e8e8e8", "#dcdcdc", "#a61b1b", "#1e7a3c", "#8a5a00")),
        theme("nord", "Nord", "نُرد", "نورد", ThemeMode.Dark,
            pal("#2e3440", "#3b4252", "#272c36", "#eceff4", "#a9b3c4", "#88c0d0", "#434c5e", "#4c566a", "#e07b85", "#a3be8c", "#ebcb8b"),
            pal("#eceff4", "#e5e9f0", "#ffffff", "#2e3440", "#4c566a", "#3f6a93", "#d8dee9", "#cdd4e0", "#b0303d", "#4f7a3a", "#8a5f00")),
        theme("catppuccin", "Catppuccin", "کاپوچینو", "كابتشينو", ThemeMode.Dark,
            pal("#1e1e2e", "#313244", "#181825", "#cdd6f4", "#a6adc8", "#cba6f7", "#45475a", "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af"),
            pal("#eff1f5", "#e6e9ef", "#ffffff", "#4c4f69", "#5c5f77", "#8839ef", "#ccd0da", "#bcc0cc", "#d20f39", "#2f7d1f", "#8a5a00")),
        theme("dracula", "Dracula", "دراکولا", "دراكولا", ThemeMode.Dark,
            pal("#282a36", "#21222c", "#191a21", "#f8f8f2", "#9aa5ce", "#bd93f9", "#44475a", "#44475a", "#ff6e6e", "#50fa7b", "#f1fa8c")),
        theme("solarized", "Solarized", "سولاریزد", "سولارايزد", ThemeMode.Dark,
            pal("#002b36", "#073642", "#00212b", "#a3b0b0", "#93a1a1", "#2aa5f0", "#0d4351", "#134a58", "#e8605d", "#85b900", "#d9a521"),
            pal("#fdf6e3", "#eee8d5", "#fffbee", "#3f565e", "#4d646b", "#1b6aa5", "#e4ddc6", "#d9d2bb", "#b52a27", "#5f7a00", "#8a5f00")),
        theme("gruvbox", "Gruvbox", "گراوباکس", "غروفبوكس", ThemeMode.Dark,
            pal("#282828", "#3c3836", "#1d2021", "#ebdbb2", "#b5a58e", "#fabd2f", "#504945", "#504945", "#fb6a55", "#b8bb26", "#fe8019"),
            pal("#fbf1c7", "#ebdbb2", "#f9f5d7", "#3c3836", "#665c54", "#af3a03", "#d5c4a1", "#d5c4a1", "#9d0006", "#5f6800", "#8a4a00")),
        theme("amoled-black", "AMOLED Black", "مشکی آمولد", "أسود أمولد", ThemeMode.Dark,
            pal("#000000", "#0b0b0b", "#000000", "#f2f2f2", "#9a9a9a", "#d9826a", "#1a1a1a", "#262626", "#f0616d", "#58c48a", "#f5c265")),
        theme("paper", "Paper", "کاغذ", "ورق", ThemeMode.Light,
            pal("#faf6ee", "#f1ebdd", "#fffdf8", "#2b2620", "#665d51", "#8a5a2b", "#e8dfcb", "#ddd2bb", "#b3261e", "#2f7d4a", "#8a5a00")),
    )

    private val BY_ID = ALL.associateBy { it.id }

    fun byId(id: String): ThemeDefinition? = BY_ID[id]

    /** Built-in ids are reserved: an installed theme may not reuse them. */
    fun isBuiltinId(id: String): Boolean = id in BY_ID

    /**
     * Picks the variant for the user's [mode] and completes it. A theme without a variant for the requested mode keeps
     * its own base look, and the returned mode says so (a dark-only theme asked for light stays dark).
     */
    fun resolve(theme: ThemeDefinition, mode: ThemeMode): ResolvedTheme {
        if (mode == theme.base) return ResolvedTheme(mode, ThemeTokens.complete(theme.tokens, cove(mode)))
        if (mode == ThemeMode.Light && theme.light != null) {
            return ResolvedTheme(ThemeMode.Light, ThemeTokens.complete(theme.light, COVE_LIGHT))
        }
        return ResolvedTheme(theme.base, ThemeTokens.complete(theme.tokens, cove(theme.base)))
    }

    /** True when the user's light/dark switch changes anything for this theme. */
    fun supportsBothModes(theme: ThemeDefinition) = theme.base == ThemeMode.Dark && theme.light != null
}
