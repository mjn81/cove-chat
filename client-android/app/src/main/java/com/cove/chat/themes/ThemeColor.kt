package com.cove.chat.themes

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Colour parsing and WCAG maths for themes (port of `client-web/src/domains/themes/utils/color.ts`).
 *
 * Theme colours are kept in the same canonical form the web uses (`H S% L%`), so the same file validates the same way
 * on every platform. The grammar is tiny on purpose: only a canonical HSL triplet ever reaches the UI.
 */
object ThemeColor {
    private const val NUM = """(\d{1,3}(?:\.\d{1,2})?)"""
    private val TRIPLET_RE = Regex("^$NUM\\s+$NUM%\\s+$NUM%$")
    private val HEX_RE = Regex("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

    /** A canonical triplet and whether any component had to be clamped. */
    data class Parsed(val value: String, val clamped: Boolean)

    private fun clamp(n: Double, lo: Double, hi: Double) = min(hi, max(lo, n))

    /** Rounds to one decimal and drops a trailing `.0` so `13.0` and `13` give the same text. */
    private fun fmt(n: Double): String {
        val r = (n * 10).roundToInt() / 10.0
        return if (r == r.toLong().toDouble()) r.toLong().toString() else r.toString()
    }

    private fun hexToRgb(hex: String): IntArray {
        var h = hex.removePrefix("#")
        if (h.length == 3) h = h.map { "$it$it" }.joinToString("")
        return intArrayOf(h.substring(0, 2).toInt(16), h.substring(2, 4).toInt(16), h.substring(4, 6).toInt(16))
    }

    private fun rgbToHsl(rgb: IntArray): DoubleArray {
        val r = rgb[0] / 255.0
        val g = rgb[1] / 255.0
        val b = rgb[2] / 255.0
        val mx = max(r, max(g, b))
        val mn = min(r, min(g, b))
        val l = (mx + mn) / 2
        if (mx == mn) return doubleArrayOf(0.0, 0.0, l * 100)
        val d = mx - mn
        val s = if (l > 0.5) d / (2 - mx - mn) else d / (mx + mn)
        val h = when (mx) {
            r -> (g - b) / d + (if (g < b) 6 else 0)
            g -> (b - r) / d + 2
            else -> (r - g) / d + 4
        }
        return doubleArrayOf(h * 60, s * 100, l * 100)
    }

    /**
     * Parses a theme colour: an `H S% L%` triplet (decimals allowed, ranges clamped) or a strict hex colour
     * (`#rgb` / `#rrggbb`, no alpha). Returns null for anything else, including every non-string.
     */
    fun parse(input: String?): Parsed? {
        val text = input?.trim() ?: return null
        if (HEX_RE.matches(text)) {
            val hsl = rgbToHsl(hexToRgb(text))
            return Parsed("${fmt(hsl[0])} ${fmt(hsl[1])}% ${fmt(hsl[2])}%", false)
        }
        val m = TRIPLET_RE.find(text) ?: return null
        val raw = doubleArrayOf(m.groupValues[1].toDouble(), m.groupValues[2].toDouble(), m.groupValues[3].toDouble())
        val h = clamp(raw[0], 0.0, 360.0)
        val s = clamp(raw[1], 0.0, 100.0)
        val l = clamp(raw[2], 0.0, 100.0)
        val clamped = h != raw[0] || s != raw[1] || l != raw[2]
        return Parsed("${fmt(h)} ${fmt(s)}% ${fmt(l)}%", clamped)
    }

    /** Converts a hex literal to a canonical triplet; for authoring the built-in palettes only. */
    fun hexToTriplet(hex: String): String = requireNotNull(if (HEX_RE.matches(hex)) parse(hex) else null) { "invalid hex colour: $hex" }.value

    private fun toHex(n: Double) = clamp(n.roundToInt().toDouble(), 0.0, 255.0).toInt().toString(16).padStart(2, '0')

    /** Linear blend of two hex colours (`t` = 0 gives [a], 1 gives [b]); returns `#rrggbb`. */
    fun mixHex(a: String, b: String, t: Double): String {
        val ca = hexToRgb(a)
        val cb = hexToRgb(b)
        return "#" + (0..2).joinToString("") { toHex(ca[it] + (cb[it] - ca[it]) * t) }
    }

    /** Converts a canonical triplet to RGB (0-255 per channel). */
    fun tripletToRgb(triplet: String): IntArray {
        val m = requireNotNull(TRIPLET_RE.find(triplet.trim())) { "invalid HSL triplet: $triplet" }
        val h = m.groupValues[1].toDouble() % 360
        val s = m.groupValues[2].toDouble() / 100
        val l = m.groupValues[3].toDouble() / 100
        fun k(n: Int) = (n + h / 30) % 12
        val a = s * min(l, 1 - l)
        fun f(n: Int) = l - a * max(-1.0, min(k(n) - 3, min(9 - k(n), 1.0)))
        return intArrayOf((f(0) * 255).roundToInt(), (f(8) * 255).roundToInt(), (f(4) * 255).roundToInt())
    }

    /** Opaque ARGB int for a canonical triplet. */
    fun tripletToArgb(triplet: String): Int {
        val (r, g, b) = tripletToRgb(triplet).toList()
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    private fun luminance(rgb: IntArray): Double {
        fun lin(c: Int): Double {
            val v = c / 255.0
            return if (v <= 0.03928) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
    }

    /** WCAG contrast ratio (1 to 21) between two canonical triplets. */
    fun contrast(a: String, b: String): Double {
        val la = luminance(tripletToRgb(a))
        val lb = luminance(tripletToRgb(b))
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private const val NEAR_BLACK = "0 0% 4%"
    private const val WHITE = "0 0% 100%"

    /** White or near-black text, whichever reads better on [background]. */
    fun pickForeground(background: String): String =
        if (contrast(WHITE, background) >= contrast(NEAR_BLACK, background)) WHITE else NEAR_BLACK
}
