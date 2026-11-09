package com.cove.chat.emoji

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text as M3Text

/**
 * One emoji drawn from the active style's sprite sheet at [size]. While the sprite is still being cut (or when no
 * style has one) the system glyph is shown instead, so there is never a blank cell.
 */
@Composable
fun EmojiView(emoji: String, size: Dp, modifier: Modifier = Modifier) {
    val key = remember(emoji) { EmojiText.key(emoji) }
    // Reading both counters re-runs the lookup when a style finishes loading or a batch of sprites arrives.
    val bmp = remember(key, EmojiEngine.version, EmojiEngine.epoch) { EmojiEngine.spriteOrRequest(key) }
    if (bmp != null) {
        Image(bmp, emoji, modifier.size(size), contentScale = ContentScale.Fit)
    } else {
        Box(modifier.size(size), contentAlignment = Alignment.Center) {
            M3Text(emoji, fontSize = (size.value * 0.78f).sp, maxLines = 1, softWrap = false)
        }
    }
}

/** A custom `:name:` emoji (static first frame; the animated ones are big only in the picker preview). */
@Composable
fun CustomEmojiView(name: String, size: Dp, modifier: Modifier = Modifier) {
    val item = EmojiEngine.customItem(name)
    if (item == null) {
        M3Text(":$name:", fontSize = (size.value * 0.5f).sp, modifier = modifier)
    } else {
        ServerImage(item.url, ":$name:", modifier.size(size))
    }
}

/**
 * Builds text where emoji are inline images. Placeholder size is relative to the font (1.35x in messages, 1.25x in
 * previews, quotes and headers) so it follows the user's font scale, like the web client. Emoji with no sprite stay
 * ordinary characters.
 */
class EmojiInline(private val fontSize: TextUnit, private val scale: Float = EmojiText.SCALE_MESSAGE) {
    /** Inline content to pass to `Text(inlineContent = ...)`. */
    val content = LinkedHashMap<String, InlineTextContent>()
    private val size: TextUnit = (if (fontSize.isSp) fontSize.value else 15f).let { (it * scale).sp }

    private fun placeholder() = Placeholder(size, size, PlaceholderVerticalAlign.TextCenter)

    /** Appends [text] to this builder, turning emoji (and known `:name:` shortcodes) into inline images. */
    fun AnnotatedString.Builder.appendWithEmoji(text: String) {
        for (t in EmojiText.tokenize(text, EmojiEngine.customNames)) when (t) {
            is EmojiToken.Text -> append(t.value)
            is EmojiToken.Emoji -> if (EmojiEngine.hasSprite(t.key)) {
                val id = "e:${t.key}"
                content.getOrPut(id) {
                    InlineTextContent(placeholder()) { alt -> EmojiView(alt, size.value.dp, Modifier.fillMaxSize()) }
                }
                appendInlineContent(id, t.value)
            } else append(t.value)
            is EmojiToken.Custom -> {
                val id = "c:${t.name}"
                content.getOrPut(id) { InlineTextContent(placeholder()) { CustomEmojiView(t.name, size.value.dp, Modifier.fillMaxSize()) } }
                appendInlineContent(id, t.value)
            }
        }
    }
}

/** Result of [rememberEmojiText]. */
class EmojiRendered(val text: AnnotatedString, val inline: Map<String, InlineTextContent>)

/** Plain [text] with emoji drawn as sprites: used for previews, names, headers and quotes. */
@Composable
fun rememberEmojiText(text: String, fontSize: TextUnit, scale: Float = EmojiText.SCALE_PREVIEW): EmojiRendered {
    val epoch = EmojiEngine.epoch
    return remember(text, fontSize, scale, epoch) {
        val inline = EmojiInline(fontSize, scale)
        val built = buildAnnotatedString { with(inline) { appendWithEmoji(text) } }
        EmojiRendered(built, inline.content)
    }
}

/**
 * Drop-in text for single-style plain strings (sidebar previews, channel names, chat header, quotes): same as `Text`
 * but emoji are sprites. Use [scale] [EmojiText.SCALE_PREVIEW] (default) for previews and [EmojiText.SCALE_MESSAGE]
 * for message bodies.
 */
@Composable
fun EmojiLabel(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontWeight: androidx.compose.ui.text.font.FontWeight? = null,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    style: TextStyle = LocalTextStyle.current,
    scale: Float = EmojiText.SCALE_PREVIEW,
) {
    val size = if (fontSize != TextUnit.Unspecified) fontSize else style.fontSize
    // Fast path: no emoji and no shortcode, so there is nothing to draw.
    if (!hasEmojiLike(text)) {
        M3Text(text, modifier, color, fontSize, fontWeight = fontWeight, maxLines = maxLines, overflow = overflow, style = style)
        return
    }
    val r = rememberEmojiText(text, size, scale)
    M3Text(r.text, modifier, color, fontSize, fontWeight = fontWeight, maxLines = maxLines, overflow = overflow, inlineContent = r.inline, style = style)
}

/** Cheap pre-check so ordinary text skips the tokenizer: any code point above the Latin range, or a `:`. */
fun hasEmojiLike(text: String): Boolean {
    for (ch in text) if (ch.code >= 0x2190 || ch == ':' ) return true
    return false
}
