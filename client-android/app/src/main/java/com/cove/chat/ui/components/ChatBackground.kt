package com.cove.chat.ui.components

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.Shader
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.cove.chat.themes.ChatBackground
import com.cove.chat.themes.ImageFit
import com.cove.chat.themes.ThemeColor
import com.cove.chat.themes.ThemeState
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Ids shared with the web client's `chatBackground` setting (`app.slice.ts`). */
val ChatBackgroundIds = listOf("none", "animals", "space", "games", "sweets", "travel", "nature", "food", "music", "tech", "weather")

/** The chosen chat background id (persisted in `PreferencesManager.chatBackground`). */
object ChatBackgroundSettings {
    var id by mutableStateOf("none")
}

/**
 * Doodle tile for one pattern. The web client masks `client-web/src/assets/patterns` SVGs at 360x740 css px;
 * converted copies (path data with transforms baked in, see the `assets/patterns` text files) are rasterised
 * once into a single bitmap and tiled by a [BitmapShader], so scrolling never re-parses or re-draws any path.
 */
private object PatternTiles {
    private const val TILE_W_DP = 360f
    private const val TILE_H_DP = 740f
    private const val STROKE = 4f // viewBox units; slightly bolder than the source's 3 so it survives the downscale

    private var cachedId: String? = null
    private var cachedScale = 0f
    private var cached: Bitmap? = null

    /** Rasterises [id] at [scale] px per dp (capped at 3 to bound memory at ~9.6 MB). Call off the main thread. */
    @Synchronized
    fun load(context: Context, id: String, scale: Float): Bitmap? {
        if (cachedId == id && cachedScale == scale) return cached
        val w = (TILE_W_DP * scale).toInt()
        val h = (TILE_H_DP * scale).toInt()
        val bmp = runCatching {
            val lines = context.assets.open("patterns/$id.txt").bufferedReader().use { it.readLines() }
            val vb = lines.first().removePrefix("#viewbox ").split(' ')
            val sx = w / vb[0].toFloat()
            val sy = h / vb[1].toFloat()
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(out)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
                strokeWidth = STROKE * (sx + sy) / 2f
                color = 0xFF000000.toInt()
            }
            val m = FloatArray(9)
            val matrix = Matrix()
            for (i in 1 until lines.size) {
                val line = lines[i]
                val bar = line.indexOf('|')
                if (bar < 0) continue
                val path: Path = runCatching { PathParser.createPathFromPathData(line.substring(bar + 1)) }.getOrNull() ?: continue
                val v = line.substring(0, bar).split(' ').map { it.toFloat() }
                // SVG matrix(a b c d e f) -> android 3x3, then scaled from viewBox units to bitmap pixels.
                m[0] = v[0] * sx; m[1] = v[2] * sx; m[2] = v[4] * sx
                m[3] = v[1] * sy; m[4] = v[3] * sy; m[5] = v[5] * sy
                m[6] = 0f; m[7] = 0f; m[8] = 1f
                matrix.setValues(m)
                path.transform(matrix)
                canvas.drawPath(path, paint)
            }
            out
        }.getOrNull()
        cachedId = id; cachedScale = scale; cached = bmp
        return bmp
    }
}

/** The id that selects the active theme's own background instead of a doodle pattern. */
private const val THEME_BACKGROUND_ID = "theme"

/**
 * Draws the selected chat background behind this composable: the tile is built once on a background thread, then
 * painted as one shader-filled rect tinted with the foreground colour at very low alpha, so it follows the theme
 * and costs one GPU draw per frame. Does nothing for `none`. `theme` draws the active (or previewed) theme's own
 * background: a pattern, flat colour, gradient or image from its `.covetheme` assets.
 */
@Composable
fun Modifier.chatBackgroundPattern(id: String = ChatBackgroundSettings.id, alpha: Float = 0.035f): Modifier {
    // While a theme preview runs, show that theme's background even if the user's own choice is a pattern.
    val effectiveId = if (id == ChatBackgroundSettings.id && ThemeState.preview != null) THEME_BACKGROUND_ID else id
    if (effectiveId == THEME_BACKGROUND_ID) return themeBackground(alpha)
    return patternBackground(effectiveId, alpha)
}

@Composable
private fun Modifier.themeBackground(alpha: Float): Modifier {
    val cfg = ThemeState.effective.chat?.background ?: return this
    return when (cfg) {
        ChatBackground.None -> this
        is ChatBackground.Pattern -> patternBackground(cfg.pattern, alpha)
        is ChatBackground.Color -> this.background(Color(ThemeColor.tripletToArgb(cfg.color)))
        is ChatBackground.Gradient -> {
            val from = Color(ThemeColor.tripletToArgb(cfg.from))
            val to = Color(ThemeColor.tripletToArgb(cfg.to))
            // CSS angle: 0deg points up, 180deg (the default) runs top to bottom.
            this.drawBehind {
                val rad = Math.toRadians(cfg.angle.toDouble())
                val dx = Math.sin(rad).toFloat()
                val dy = -Math.cos(rad).toFloat()
                val half = (Math.abs(size.width * dx) + Math.abs(size.height * dy)) / 2f
                val mid = androidx.compose.ui.geometry.Offset(size.width / 2f, size.height / 2f)
                val d = androidx.compose.ui.geometry.Offset(dx * half, dy * half)
                drawRect(Brush.linearGradient(listOf(from, to), start = mid - d, end = mid + d))
            }
        }
        is ChatBackground.Image -> {
            val asset = ThemeState.effectiveAssets[cfg.asset] ?: return this
            val image by produceState<ImageBitmap?>(null, asset) {
                value = withContext(Dispatchers.Default) { decodeThemeImage(asset.bytes, cfg.blur) }
            }
            val bmp = image ?: return this
            this.drawBehind { drawThemeImage(bmp, cfg) }
        }
    }
}

/** Decodes a theme image (already sniffed and bounded) at a size the screen can use; blur is a down/up-scale blur. */
private fun decodeThemeImage(bytes: ByteArray, blur: Float): ImageBitmap? {
    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
    val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    if (blur <= 0f) return bmp.asImageBitmap()
    // Cheap blur that works on every API level: shrink, then draw back up with bilinear filtering.
    val k = 1f + blur / 2f
    return Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width / k).toInt()), maxOf(1, (bmp.height / k).toInt()), true).asImageBitmap()
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawThemeImage(img: ImageBitmap, cfg: ChatBackground.Image) {
    val w = size.width
    val h = size.height
    val iw = img.width.toFloat()
    val ih = img.height.toFloat()
    when (cfg.fit) {
        ImageFit.Cover, ImageFit.Contain -> {
            val scale = if (cfg.fit == ImageFit.Cover) maxOf(w / iw, h / ih) else minOf(w / iw, h / ih)
            val dw = (iw * scale).toInt()
            val dh = (ih * scale).toInt()
            drawImage(
                img, dstOffset = androidx.compose.ui.unit.IntOffset(((w - dw) / 2).toInt(), ((h - dh) / 2).toInt()),
                dstSize = androidx.compose.ui.unit.IntSize(dw, dh), alpha = cfg.opacity,
                filterQuality = androidx.compose.ui.graphics.FilterQuality.Medium,
            )
        }
        ImageFit.Tile -> {
            var y = 0f
            while (y < h) {
                var x = 0f
                while (x < w) { drawImage(img, topLeft = androidx.compose.ui.geometry.Offset(x, y), alpha = cfg.opacity); x += iw }
                y += ih
            }
        }
    }
}

@Composable
private fun Modifier.patternBackground(id: String, alpha: Float): Modifier {
    if (id == "none" || id !in ChatBackgroundIds) return this
    val context = LocalContext.current.applicationContext
    val density = LocalDensity.current.density
    val scale = minOf(density, 3f)
    val tile by produceState<Bitmap?>(null, id, scale) {
        value = withContext(Dispatchers.Default) { PatternTiles.load(context, id, scale) }
    }
    val tint = CoveTheme.extendedColors.textPrimary.copy(alpha = alpha).toArgb()
    val paint = remember { Paint(Paint.FILTER_BITMAP_FLAG) }
    val bitmap = tile ?: return this
    val shader = remember(bitmap, density) {
        // Bitmap pixels -> dp-sized tile in device pixels.
        BitmapShader(bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
            .apply { setLocalMatrix(Matrix().apply { setScale(density / scale, density / scale) }) }
    }
    return this.drawBehind {
        paint.shader = shader
        paint.colorFilter = PorterDuffColorFilter(tint, PorterDuff.Mode.SRC_IN)
        drawIntoCanvas { it.nativeCanvas.drawRect(0f, 0f, size.width, size.height, paint) }
    }
}
