package com.nodetalk.client.ui.components

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
private val TRAILING_PUNCT = Regex("""[.,!?;:'"\]}]$""")

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
fun linkifiedText(text: String, linkColor: Color): AnnotatedString = buildAnnotatedString {
    for (t in tokenizeMessage(text)) when (t) {
        is MessageToken.Plain -> append(t.value)
        is MessageToken.Mention -> withStyle(SpanStyle(color = linkColor, fontWeight = FontWeight.Medium)) { append(t.value) }
        is MessageToken.Link -> withLink(
            LinkAnnotation.Url(t.href, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))
        ) { append(t.value) }
    }
}
