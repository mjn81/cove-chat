package com.cove.chat.emoji

/** A piece of text after emoji and `:name:` detection. Tokens concatenate back to the original text. */
sealed interface EmojiToken {
    data class Text(val value: String) : EmojiToken
    /** One emoji grapheme; [key] is the sprite-index key (see [EmojiText.key]). */
    data class Emoji(val value: String, val key: String) : EmojiToken
    data class Custom(val value: String, val name: String) : EmojiToken
}

/** How a message is laid out, decided from its text alone (the wire format stays plain Unicode). */
sealed interface EmojiMessageClass {
    data object Normal : EmojiMessageClass
    /** Two or three emoji, or one without an animation: large static images. */
    data class Jumbo(val count: Int) : EmojiMessageClass
    /** Exactly one emoji that has an entry in the animated table. */
    data class Animated(val key: String, val emoji: String) : EmojiMessageClass
}

/**
 * Emoji text helpers shared by the renderer, the composer and the big-emoji rule (port of
 * `client-web/src/domains/emoji/utils/emoji-text.ts` and `classify-emoji-message.ts`, rules in `docs/emoji-stickers-client.md`).
 * Pure Kotlin with no Android classes so it runs in JVM unit tests. Grapheme splitting is a small emoji-aware state
 * machine (the platform BreakIterator differs per OS version); non-emoji text is never split.
 */
object EmojiText {
    private const val ZWJ = 0x200D
    private const val VS16 = 0xFE0F
    private const val KEYCAP = 0x20E3

    /** Most emoji a message may hold and still be shown jumbo. */
    const val MAX_JUMBO = 3

    private const val NAME = "[a-z0-9_]{2,32}"
    private val CUSTOM_RE = Regex(":($NAME):")
    private val NAME_RE = Regex("^$NAME$")

    // Emoji_Presentation=Yes ranges (Unicode 15.1): these code points are drawn as emoji without U+FE0F.
    private val PRESENTATION = intArrayOf(
        0x231A, 0x231B, 0x23E9, 0x23EC, 0x23F0, 0x23F0, 0x23F3, 0x23F3, 0x25FD, 0x25FE, 0x2614, 0x2615, 0x2648, 0x2653, 0x267F, 0x267F,
        0x2693, 0x2693, 0x26A1, 0x26A1, 0x26AA, 0x26AB, 0x26BD, 0x26BE, 0x26C4, 0x26C5, 0x26CE, 0x26CE, 0x26D4, 0x26D4, 0x26EA, 0x26EA,
        0x26F2, 0x26F3, 0x26F5, 0x26F5, 0x26FA, 0x26FA, 0x26FD, 0x26FD, 0x2705, 0x2705, 0x270A, 0x270B, 0x2728, 0x2728, 0x274C, 0x274C,
        0x274E, 0x274E, 0x2753, 0x2755, 0x2757, 0x2757, 0x2795, 0x2797, 0x27B0, 0x27B0, 0x27BF, 0x27BF, 0x2B1B, 0x2B1C, 0x2B50, 0x2B50,
        0x2B55, 0x2B55, 0x1F004, 0x1F004, 0x1F0CF, 0x1F0CF, 0x1F18E, 0x1F18E, 0x1F191, 0x1F19A, 0x1F1E6, 0x1F1FF, 0x1F201, 0x1F201,
        0x1F21A, 0x1F21A, 0x1F22F, 0x1F22F, 0x1F232, 0x1F236, 0x1F238, 0x1F23A, 0x1F250, 0x1F251, 0x1F300, 0x1F320, 0x1F32D, 0x1F335,
        0x1F337, 0x1F37C, 0x1F37E, 0x1F393, 0x1F3A0, 0x1F3CA, 0x1F3CF, 0x1F3D3, 0x1F3E0, 0x1F3F0, 0x1F3F4, 0x1F3F4, 0x1F3F8, 0x1F43E,
        0x1F440, 0x1F440, 0x1F442, 0x1F4FC, 0x1F4FF, 0x1F53D, 0x1F54B, 0x1F54E, 0x1F550, 0x1F567, 0x1F57A, 0x1F57A, 0x1F595, 0x1F596,
        0x1F5A4, 0x1F5A4, 0x1F5FB, 0x1F64F, 0x1F680, 0x1F6C5, 0x1F6CC, 0x1F6CC, 0x1F6D0, 0x1F6D2, 0x1F6D5, 0x1F6D7, 0x1F6DC, 0x1F6DF,
        0x1F6EB, 0x1F6EC, 0x1F6F4, 0x1F6FC, 0x1F7E0, 0x1F7EB, 0x1F7F0, 0x1F7F0, 0x1F90C, 0x1F93A, 0x1F93C, 0x1F945, 0x1F947, 0x1F9FF,
        0x1FA70, 0x1FA7C, 0x1FA80, 0x1FA89, 0x1FA8F, 0x1FAC6, 0x1FACE, 0x1FADC, 0x1FADF, 0x1FAE9, 0x1FAF0, 0x1FAF8,
    )

    private fun isPresentation(cp: Int): Boolean {
        var lo = 0
        var hi = PRESENTATION.size / 2 - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            when {
                cp < PRESENTATION[mid * 2] -> hi = mid - 1
                cp > PRESENTATION[mid * 2 + 1] -> lo = mid + 1
                else -> return true
            }
        }
        return false
    }

    private fun isSkinTone(cp: Int) = cp in 0x1F3FB..0x1F3FF
    private fun isRegional(cp: Int) = cp in 0x1F1E6..0x1F1FF
    private fun isTag(cp: Int) = cp in 0xE0020..0xE007F
    /** Code points that can follow a ZWJ inside a sequence (symbols like the male sign, the heart, or any emoji). */
    private fun isJoinable(cp: Int) = isPresentation(cp) || cp in 0x2190..0x2BFF || cp in 0x1F000..0x1FAFF || cp == 0x00A9 || cp == 0x00AE
    private fun isKeycapBase(cp: Int) = cp == '#'.code || cp == '*'.code || cp in '0'.code..'9'.code

    /**
     * The sprite-index key: lower-case hex code points joined by `-` with every U+FE0F removed (a red heart is `2764`,
     * a thumbs up with skin tone is `1f44d-1f3fd`).
     */
    fun key(emoji: String): String {
        val parts = ArrayList<String>()
        var i = 0
        while (i < emoji.length) {
            val cp = emoji.codePointAt(i)
            if (cp != VS16) parts += cp.toString(16)
            i += Character.charCount(cp)
        }
        return parts.joinToString("-")
    }

    /**
     * Length (in chars) of the emoji grapheme starting at [start], or 0 when the text there is not an emoji. A grapheme
     * is an emoji when its first code point has emoji presentation, or it carries U+FE0F / the keycap mark.
     */
    internal fun emojiLengthAt(s: String, start: Int): Int {
        if (start >= s.length) return 0
        var i = start
        val first = s.codePointAt(i)
        i += Character.charCount(first)
        var emoji = isPresentation(first)
        var progressed = true

        if (isRegional(first)) {
            // A flag is a pair of regional indicators; a lone one is still drawn as a (letter) emoji.
            if (i < s.length && isRegional(s.codePointAt(i))) i += Character.charCount(s.codePointAt(i))
            return i - start
        }

        fun eatModifiers() {
            while (i < s.length) {
                val cp = s.codePointAt(i)
                when {
                    cp == VS16 -> { emoji = true; i += 1 }
                    cp == KEYCAP -> { emoji = true; i += 1 }
                    isSkinTone(cp) -> { emoji = true; i += Character.charCount(cp) }
                    isTag(cp) -> { i += Character.charCount(cp) }
                    else -> return
                }
            }
        }

        if (isKeycapBase(first)) {
            // Digits, # and * are emoji only as keycaps: base, optional VS16, then U+20E3.
            var j = i
            if (j < s.length && s.codePointAt(j) == VS16) j += 1
            return if (j < s.length && s.codePointAt(j) == KEYCAP) j + 1 - start else 0
        }

        eatModifiers()
        while (progressed) {
            progressed = false
            if (i + 1 < s.length && s.codePointAt(i) == ZWJ) {
                val next = s.codePointAt(i + 1)
                if (isJoinable(next)) {
                    i += 1 + Character.charCount(next)
                    emoji = emoji || isPresentation(next)
                    eatModifiers()
                    progressed = true
                }
            }
        }
        return if (emoji) i - start else 0
    }

    /**
     * Splits message text into text, emoji and custom `:name:` tokens.
     * [customNames]: names of the server's custom emoji; an unknown `:name:` stays text, exactly as typed.
     */
    fun tokenize(text: String, customNames: Set<String> = emptySet()): List<EmojiToken> {
        val tokens = ArrayList<EmojiToken>()
        fun pushText(v: String) {
            if (v.isEmpty()) return
            val prev = tokens.lastOrNull()
            if (prev is EmojiToken.Text) tokens[tokens.size - 1] = EmojiToken.Text(prev.value + v) else tokens += EmojiToken.Text(v)
        }
        fun pushPlain(chunk: String) {
            var i = 0
            while (i < chunk.length) {
                val n = emojiLengthAt(chunk, i)
                if (n > 0) {
                    val g = chunk.substring(i, i + n)
                    tokens += EmojiToken.Emoji(g, key(g))
                    i += n
                } else {
                    val cp = chunk.codePointAt(i)
                    val len = Character.charCount(cp)
                    pushText(chunk.substring(i, i + len))
                    i += len
                }
            }
        }
        if (customNames.isEmpty() || !text.contains(':')) { pushPlain(text); return tokens }
        var last = 0
        var from = 0
        while (true) {
            val m = CUSTOM_RE.find(text, from) ?: break
            if (m.groupValues[1] !in customNames) {
                // Step back so the closing colon can open the next shortcode (":nope:aa:" still finds ":aa:").
                from = m.range.first + 1
                continue
            }
            pushPlain(text.substring(last, m.range.first))
            tokens += EmojiToken.Custom(m.value, m.groupValues[1])
            last = m.range.last + 1
            from = last
        }
        pushPlain(text.substring(last))
        return tokens
    }

    /**
     * Telegram-style big emoji: exactly one emoji with an animation is [EmojiMessageClass.Animated]; one without or two to
     * three is [EmojiMessageClass.Jumbo]; anything else (other text, four or more) is normal. Whitespace is ignored.
     */
    fun classify(text: String, hasAnimation: (String) -> Boolean = { false }, customNames: Set<String> = emptySet()): EmojiMessageClass {
        if (text.length > 120) return EmojiMessageClass.Normal
        val tokens = tokenize(text, customNames)
        var count = 0
        var custom = 0
        var single: EmojiToken.Emoji? = null
        for (t in tokens) when (t) {
            is EmojiToken.Emoji -> { count++; single = t }
            is EmojiToken.Custom -> { count++; custom++ }
            is EmojiToken.Text -> if (t.value.isNotBlank()) return EmojiMessageClass.Normal
        }
        if (count == 0 || count > MAX_JUMBO) return EmojiMessageClass.Normal
        val only = single
        if (count == 1 && custom == 0 && only != null && hasAnimation(only.key)) return EmojiMessageClass.Animated(only.key, only.value)
        return EmojiMessageClass.Jumbo(count)
    }

    /** The first emoji in [text], or "" when there is none (a sticker's emoji field may hold several characters). */
    fun firstEmoji(text: String): String =
        (tokenize(text).firstOrNull { it is EmojiToken.Emoji } as? EmojiToken.Emoji)?.value.orEmpty()

    /** Normalises what an admin typed as a custom emoji name the way the server does. */
    fun normalizeName(input: String): String =
        input.trim().trim(':').lowercase().replace(Regex("[\\s-]+"), "_")

    fun isValidName(name: String) = NAME_RE.matches(name)

    /** Emoji point size relative to the font size: 1.35x in message text, 1.25x in previews, quotes and headers. */
    const val SCALE_MESSAGE = 1.35f
    const val SCALE_PREVIEW = 1.25f

    /** Jumbo sprite size in dp for 1, 2 and 3 emoji (`docs/emoji-stickers-client.md` section 3). */
    fun jumboDp(count: Int): Int = when (count) { 1 -> 64; 2 -> 52; else -> 44 }

    /** Animated big emoji size in dp. */
    const val ANIMATED_DP = 128

    /** Columns of the emoji grid for the measured width: `clamp(floor(w / 40), 5, 12)`, default 9 before measuring. */
    fun pickerColumns(widthDp: Float): Int = if (widthDp <= 0f) 9 else (widthDp / 40f).toInt().coerceIn(5, 12)

    /** Columns of the sticker grid: `clamp(floor(w / 84), 3, 6)`, default 4. */
    fun stickerColumns(widthDp: Float): Int = if (widthDp <= 0f) 4 else (widthDp / 84f).toInt().coerceIn(3, 6)
}
