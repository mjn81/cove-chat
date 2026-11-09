package com.cove.chat.emoji

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp

/** Whether animations may play: the user's switch is on and the system's "remove animations" is off. */
@Composable
fun animatedEmojiAllowed(): Boolean {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    return remember(EmojiEngine.epoch) {
        val scale = runCatching { android.provider.Settings.Global.getFloat(ctx.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }.getOrDefault(1f)
        CoveApp.instance.preferencesManager.animatedEmoji && scale > 0f
    }
}

/** How [text] should be laid out (normal, jumbo or one big animated emoji), with the animation switch applied. */
@Composable
fun rememberEmojiMessageClass(text: String): EmojiMessageClass {
    val animate = animatedEmojiAllowed()
    val epoch = EmojiEngine.epoch
    return remember(text, animate, epoch) {
        EmojiText.classify(text, if (animate) ({ key -> EmojiEngine.animatedUrl(key) != null }) else ({ false }), EmojiEngine.customNames)
    }
}

/**
 * Telegram-style big emoji (docs/emoji-stickers-client.md section 3): exactly one emoji with an animation plays it at
 * 128 dp (tap replays); one without, or two to three emoji, are jumbo static images (64 / 52 / 44 dp); no bubble.
 */
@Composable
fun BigEmojiMessage(cls: EmojiMessageClass, text: String, modifier: Modifier = Modifier) {
    when (cls) {
        is EmojiMessageClass.Animated -> {
            val url = EmojiEngine.animatedUrl(cls.key)
            Box(modifier.size(EmojiText.ANIMATED_DP.dp)) {
                // The static image sits underneath so the cell is never empty while the animation downloads.
                EmojiView(cls.emoji, EmojiText.ANIMATED_DP.dp)
                if (url != null) AnimatedServerImage(url, cls.emoji, Modifier.size(EmojiText.ANIMATED_DP.dp), loopForever = false, replayOnTap = true)
            }
        }
        is EmojiMessageClass.Jumbo -> {
            val size = EmojiText.jumboDp(cls.count).dp
            val tokens = remember(text, EmojiEngine.epoch) { EmojiText.tokenize(text, EmojiEngine.customNames).filter { it !is EmojiToken.Text } }
            Row(modifier.padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (t in tokens) when (t) {
                    is EmojiToken.Emoji -> EmojiView(t.value, size)
                    is EmojiToken.Custom -> CustomEmojiView(t.name, size)
                    is EmojiToken.Text -> Unit
                }
            }
        }
        EmojiMessageClass.Normal -> Unit
    }
}
