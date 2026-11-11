package com.cove.chat.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle

/** A piece of a chat message after link/mention detection (mirrors client-web `tokenizeMessage`). */
sealed interface MessageToken {
    data class Plain(val value: String) : MessageToken
    data class Mention(val value: String) : MessageToken
    data class Link(val value: String, val href: String) : MessageToken
}

// Emails first so `me@example.com` is not split into a mention; only http(s)/www/email forms ever become links.
private val TOKEN_RE = Regex("""([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)|((?:https?://|www\.)[^\s<>"']+)|(@\w+)""")
// `*_~` are included so `**https://x.com**` keeps the emphasis markers out of the link.
private val TRAILING_PUNCT = Regex("""[.,!?;:'"\]}*_~]$""")
private val STICKY_TOKEN = java.util.regex.Pattern.compile(TOKEN_RE.pattern)

/** Trims sentence punctuation (and an unbalanced `)`) from the end of a URL match. */
private fun trimUrl(raw: String): Pair<String, String> {
    var url = raw
    while (true) {
        url = when {
            TRAILING_PUNCT.containsMatchIn(url) -> url.dropLast(1)
            url.endsWith(")") && url.count { it == ')' } > url.count { it == '(' } -> url.dropLast(1)
            else -> break
        }
    }
    return url to raw.substring(url.length)
}

/**
 * Matches a link, email or @mention starting exactly at [index] (callers ensure it is at a word start).
 * Returns the token and the number of characters it consumed, or null.
 */
fun matchAutoLinkAt(text: String, index: Int): Pair<MessageToken, Int>? {
    val m = STICKY_TOKEN.matcher(text).region(index, text.length)
    if (!m.lookingAt()) return null
    m.group(1)?.let { return MessageToken.Link(it, "mailto:$it") to it.length }
    m.group(2)?.let {
        val (url, _) = trimUrl(it)
        if (url.isEmpty()) return null
        return MessageToken.Link(url, if (url.startsWith("www.", ignoreCase = true)) "https://$url" else url) to url.length
    }
    return MessageToken.Mention(m.group(3)!!) to m.group(3)!!.length
}

/** Splits [text] into plain text, `@mentions`, URLs and emails; the tokens concatenate back to [text]. */
fun tokenizeMessage(text: String): List<MessageToken> {
    val tokens = ArrayList<MessageToken>()
    var last = 0
    fun plain(s: String) {
        if (s.isEmpty()) return
        val prev = tokens.lastOrNull()
        if (prev is MessageToken.Plain) tokens[tokens.lastIndex] = MessageToken.Plain(prev.value + s) else tokens.add(MessageToken.Plain(s))
    }
    for (m in TOKEN_RE.findAll(text)) {
        val start = m.range.first
        if (m.groups[3] != null && start > 0 && text[start - 1].isLetterOrDigit()) continue // `foo@bar` inside a word
        plain(text.substring(last, start))
        when {
            m.groups[1] != null -> tokens.add(MessageToken.Link(m.value, "mailto:${m.value}"))
            m.groups[2] != null -> {
                val (url, rest) = trimUrl(m.value)
                tokens.add(MessageToken.Link(url, if (url.startsWith("www.", ignoreCase = true)) "https://$url" else url))
                plain(rest)
            }
            else -> tokens.add(MessageToken.Mention(m.value))
        }
        last = m.range.last + 1
    }
    plain(text.substring(last))
    return tokens
}

/**
 * Builds the displayed message: links are tappable (the default handler opens the browser/mail app) and styled in
 * [linkColor] with an underline; `@mentions` are bold in the same colour, like the web client.
 */
fun linkifiedText(
    text: String, linkColor: Color, onMention: ((username: String) -> Unit)? = null, onInvite: ((code: String) -> Unit)? = null,
    emoji: com.cove.chat.emoji.EmojiInline? = null
): AnnotatedString = buildAnnotatedString {
    for (t in tokenizeMessage(text)) when (t) {
        is MessageToken.Plain -> if (emoji != null) with(emoji) { appendWithEmoji(t.value) } else append(t.value)
        is MessageToken.Mention -> if (onMention == null) {
            withStyle(SpanStyle(color = linkColor, fontWeight = FontWeight.Medium)) { append(t.value) }
        } else {
            // Tapping a mention opens that member's profile.
            withLink(
                LinkAnnotation.Clickable(t.value, TextLinkStyles(SpanStyle(color = linkColor, fontWeight = FontWeight.Medium))) { onMention(t.value.removePrefix("@")) }
            ) { append(t.value) }
        }
        is MessageToken.Link -> {
            val style = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
            val invite = if (onInvite != null) com.cove.chat.ui.screens.InviteLinks.code(t.href) else null
            // A channel invite opens in the app (join card) instead of the browser.
            val link = if (invite != null) LinkAnnotation.Url(t.href, style) { onInvite?.invoke(invite) } else LinkAnnotation.Url(t.href, style)
            withLink(link) { append(t.value) }
        }
    }
}
