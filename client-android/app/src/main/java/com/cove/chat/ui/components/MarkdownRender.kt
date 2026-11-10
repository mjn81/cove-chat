package com.cove.chat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.screens.InviteLinks
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.delay

/** Appends [nodes] to this builder with the shared Markdown styling (see client-web `components/markdown-text.tsx`). */
fun AnnotatedString.Builder.appendInlines(
    nodes: List<MdInline>,
    linkColor: Color,
    codeBackground: Color,
    onMention: ((username: String) -> Unit)? = null,
    onInvite: ((code: String) -> Unit)? = null,
    emoji: com.cove.chat.emoji.EmojiInline? = null
) {
    val underline = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
    fun link(href: String): LinkAnnotation {
        val invite = if (onInvite != null) InviteLinks.code(href) else null
        // A channel invite opens in the app (join card) instead of the browser; the default handler opens everything else.
        return if (invite != null) LinkAnnotation.Url(href, underline) { onInvite?.invoke(invite) } else LinkAnnotation.Url(href, underline)
    }
    for (n in nodes) when (n) {
        is MdInline.Text -> if (emoji != null) with(emoji) { appendWithEmoji(n.value) } else append(n.value)
        is MdInline.Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(n.value) }
        is MdInline.Styled -> {
            val style = when (n.kind) {
                MdInline.Kind.Bold -> SpanStyle(fontWeight = FontWeight.SemiBold)
                MdInline.Kind.Italic -> SpanStyle(fontStyle = FontStyle.Italic)
                MdInline.Kind.Strike -> SpanStyle(textDecoration = TextDecoration.LineThrough)
            }
            withStyle(style) { appendInlines(n.children, linkColor, codeBackground, onMention, onInvite, emoji) }
        }
        is MdInline.Link -> withLink(link(n.href)) { appendInlines(n.children, linkColor, codeBackground, null, null, emoji) }
        is MdInline.Auto -> withLink(link(n.href)) { append(n.value) }
        is MdInline.Mention -> if (onMention == null) {
            withStyle(SpanStyle(color = linkColor, fontWeight = FontWeight.Medium)) { append(n.value) }
        } else {
            withLink(LinkAnnotation.Clickable(n.value, TextLinkStyles(SpanStyle(color = linkColor, fontWeight = FontWeight.Medium))) { onMention(n.value.removePrefix("@")) }) { append(n.value) }
        }
    }
}

/** Fenced code block with a copy button; the code itself is selectable. */
@Composable
fun MdCodeBlock(code: String, lang: String, textColor: Color, fontSize: TextUnit, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) { delay(1400); copied = false }
    }
    val shape = RoundedCornerShape(6.dp)
    Column(modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape)) {
        Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 4.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(lang, color = c.textMuted, fontSize = 11.sp, modifier = Modifier.weight(1f))
            Row(
                Modifier.clip(RoundedCornerShape(4.dp)).clickable { clipboard.setText(AnnotatedString(code)); copied = true }.padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy, null, tint = if (copied) c.success else c.textMuted, modifier = Modifier.size(13.dp))
                Text(if (copied) "Copied" else "Copy code", color = c.textMuted, fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp))
            }
        }
        SelectionContainer {
            Text(
                code, color = textColor, fontSize = fontSize * 0.9f, fontFamily = FontFamily.Monospace,
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, bottom = 8.dp, top = 2.dp)
            )
        }
    }
}

/**
 * Renders a release note / changelog body: headings, lists, quotes, code and links. Everything goes through
 * [parseMarkdown] in [MdMode.Document], so no raw HTML is ever interpreted; links open in the browser via the
 * default URL handler, and only http(s)/mailto targets are created.
 */
@Composable
fun MarkdownDocument(text: String, color: Color, linkColor: Color, fontSize: TextUnit, modifier: Modifier = Modifier) {
    val blocks = remember(text) { parseMarkdown(text, MdMode.Document) }
    SelectionContainer {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (b in blocks) MdBlockView(b, color, linkColor, fontSize, 0)
        }
    }
}

@Composable
private fun MdBlockView(block: MdBlock, color: Color, linkColor: Color, fontSize: TextUnit, depth: Int) {
    val c = CoveTheme.extendedColors
    val codeBg = c.card
    when (block) {
        is MdBlock.Text -> {
            val body = remember(block, linkColor) { buildAnnotatedString { appendInlines(block.children, linkColor, codeBg) } }
            Text(body, color = color, fontSize = fontSize, lineHeight = fontSize * 1.45f)
        }
        is MdBlock.Heading -> {
            val body = remember(block, linkColor) { buildAnnotatedString { appendInlines(block.children, linkColor, codeBg) } }
            val scale = when (block.level) { 1 -> 1.35f; 2 -> 1.2f; 3 -> 1.1f; else -> 1f }
            Text(body, color = if (block.level >= 6) c.textMuted else c.textPrimary, fontSize = fontSize * scale, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp))
        }
        is MdBlock.Code -> MdCodeBlock(block.value, block.lang, color, fontSize)
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(linkColor.copy(alpha = 0.6f)))
            Column(Modifier.padding(start = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (child in block.children) MdBlockView(child, color, linkColor, fontSize, depth + 1)
            }
        }
        is MdBlock.ListBlock -> Column(Modifier.padding(start = (if (depth > 0) 4 else 0).dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            block.items.forEachIndexed { index, item ->
                Row {
                    Text(if (block.ordered) "${block.start + index}." else "•", color = c.textMuted, fontSize = fontSize, modifier = Modifier.width(22.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        for (child in item) MdBlockView(child, color, linkColor, fontSize, depth + 1)
                    }
                }
            }
        }
        MdBlock.Rule -> Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).height(1.dp).background(c.border))
    }
}
