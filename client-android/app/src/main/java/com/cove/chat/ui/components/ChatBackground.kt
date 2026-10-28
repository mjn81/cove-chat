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
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Ids shared with the web client's `chatBackground` setting (`app.slice.ts`). */
val ChatBackgroundIds = listOf("none", "animals", "space", "games", "sweets")

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
    private const val STROKE = 3.5f // viewBox units; slightly bolder than the source's 3 so it survives the downscale

    private var cachedId: String? = null
    private var cachedScale = 0f
    private var cached: Bitmap? = null

    /** Rasterises [id] at [scale] px per dp (capped at 2 to bound memory at ~4.3 MB). Call off the main thread. */
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

/**
 * Draws the selected chat background behind this composable: the tile is built once on a background thread, then
 * painted as one shader-filled rect tinted with the foreground colour at very low alpha, so it follows light/dark
 * and costs one GPU draw per frame. Does nothing for `none`.
 */
@Composable
fun Modifier.chatBackgroundPattern(id: String = ChatBackgroundSettings.id, alpha: Float = 0.028f): Modifier {
    if (id == "none" || id !in ChatBackgroundIds) return this
    val context = LocalContext.current.applicationContext
    val density = LocalDensity.current.density
    val scale = minOf(density, 2f)
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
