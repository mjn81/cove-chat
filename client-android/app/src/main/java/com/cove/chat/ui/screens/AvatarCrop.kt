package com.cove.chat.ui.screens

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.cove.chat.ui.components.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

/** How far the crop can zoom in, as a multiple of the "fill the circle" size. */
const val MAX_CROP_ZOOM = 6f

/** The square of the source image to keep: top-left corner and side, in source pixels. */
data class CropSquare(val left: Float, val top: Float, val side: Float)

/** Zoom is limited to 1x (the image just fills the circle) up to [MAX_CROP_ZOOM]. */
fun clampZoom(zoom: Float): Float = zoom.coerceIn(1f, MAX_CROP_ZOOM)

/** Pixels per source pixel when the image just covers a square viewport of [viewport] px. */
private fun coverScale(imageW: Int, imageH: Int, viewport: Float) = viewport / min(imageW, imageH)

/**
 * Keeps a drag inside the range where the image still covers the whole viewport, so the crop never shows empty space.
 *
 * @param offsetX horizontal shift of the image centre from the viewport centre, in screen px.
 * @return the clamped (x, y) shift.
 */
fun clampCropOffset(imageW: Int, imageH: Int, viewport: Float, zoom: Float, offsetX: Float, offsetY: Float): Pair<Float, Float> {
    val s = coverScale(imageW, imageH, viewport) * zoom
    val maxX = max(0f, (imageW * s - viewport) / 2f)
    val maxY = max(0f, (imageH * s - viewport) / 2f)
    return offsetX.coerceIn(-maxX, maxX) to offsetY.coerceIn(-maxY, maxY)
}

/**
 * Which part of the image the viewport shows, as a square in source pixels.
 *
 * @param viewport side of the on-screen crop square, in px.
 * @param zoom 1 = the image just covers the square.
 * @param offsetX horizontal shift of the image from centred, in screen px (positive = image moved right).
 */
fun cropSquare(imageW: Int, imageH: Int, viewport: Float, zoom: Float, offsetX: Float, offsetY: Float): CropSquare {
    val s = coverScale(imageW, imageH, viewport) * clampZoom(zoom)
    val (ox, oy) = clampCropOffset(imageW, imageH, viewport, clampZoom(zoom), offsetX, offsetY)
    val side = viewport / s
    val cx = imageW / 2f - ox / s
    val cy = imageH / 2f - oy / s
    return CropSquare(cx - side / 2f, cy - side / 2f, side)
}

/** Decodes [uri] upright (EXIF rotation applied) and no larger than about 2048px, enough for a crisp 512px avatar. */
private fun decodeForCrop(context: android.content.Context, uri: Uri): Bitmap? = runCatching {
    if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val longest = max(info.size.width, info.size.height)
            if (longest > 2048) decoder.setTargetSampleSize((longest / 2048) + 1)
        }
    } else {
        context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it) }
    }
}.getOrNull()

/** Cuts [crop] out of [source] and returns it as a 512px (at most) WebP, what the web cropper produces. */
private fun encodeCrop(source: Bitmap, crop: CropSquare): ByteArray {
    val side = crop.side.toInt().coerceIn(1, min(source.width, source.height))
    val left = crop.left.toInt().coerceIn(0, source.width - side)
    val top = crop.top.toInt().coerceIn(0, source.height - side)
    val square = Bitmap.createBitmap(source, left, top, side, side)
    val scaled = if (side > 512) Bitmap.createScaledBitmap(square, 512, 512, true) else square
    val out = ByteArrayOutputStream()
    val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
    scaled.compress(format, 88, out)
    return out.toByteArray()
}

/**
 * Full-screen photo cropper, like Telegram's: the picked photo sits behind a circular window; drag to move it and pinch
 * to zoom, then tick to use it. The result is the cropped square as WebP bytes.
 *
 * @param onDone receives the cropped image; the caller uploads it.
 */
@Composable
fun AvatarCropDialog(uri: Uri, onCancel: () -> Unit, onDone: (ByteArray) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bitmap by remember(uri) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(uri) { mutableStateOf(false) }
    var zoom by remember(uri) { mutableFloatStateOf(1f) }
    var offset by remember(uri) { mutableStateOf(Offset.Zero) }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(uri) {
        val decoded = withContext(Dispatchers.IO) { decodeForCrop(context, uri) }
        if (decoded == null) failed = true else bitmap = decoded
    }

    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
            val bmp = bitmap
            // The crop circle is as wide as the screen allows, with a margin.
            val density = androidx.compose.ui.platform.LocalDensity.current
            val viewportPx = with(density) { ((if (maxWidth < maxHeight) maxWidth else maxHeight) - 32.dp).toPx() }
            val dim = Color.Black.copy(alpha = 0.62f)

            if (bmp != null) {
                val image = remember(bmp) { bmp.asImageBitmap() }
                Canvas(
                    Modifier.fillMaxSize().pointerInput(bmp, viewportPx) {
                        detectTransformGestures { _, pan, gestureZoom, _ ->
                            val z = clampZoom(zoom * gestureZoom)
                            val (x, y) = clampCropOffset(bmp.width, bmp.height, viewportPx, z, offset.x + pan.x, offset.y + pan.y)
                            zoom = z
                            offset = Offset(x, y)
                        }
                    }
                ) {
                    val s = viewportPx / min(bmp.width, bmp.height) * zoom
                    val w = bmp.width * s
                    val h = bmp.height * s
                    drawImage(
                        image,
                        dstOffset = IntOffset((size.width / 2 + offset.x - w / 2).toInt(), (size.height / 2 + offset.y - h / 2).toInt()),
                        dstSize = IntSize(w.toInt(), h.toInt())
                    )
                    // Dim everything outside the circular window.
                    val window = Rect(Offset(size.width / 2 - viewportPx / 2, size.height / 2 - viewportPx / 2), androidx.compose.ui.geometry.Size(viewportPx, viewportPx))
                    val mask = Path().apply {
                        fillType = PathFillType.EvenOdd
                        addRect(Rect(Offset.Zero, size))
                        addOval(window)
                    }
                    drawPath(mask, dim)
                }
            } else if (failed) {
                Text("That file isn't a supported image.", color = Color.White, modifier = Modifier.align(Alignment.Center))
            } else {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.align(Alignment.Center))
            }

            // Cancel and confirm along the bottom, like Telegram.
            // A dialog window does not always report the gesture-bar inset, so keep generous room at the bottom.
            Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 44.dp)) {
                Box(Modifier.size(52.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.14f)).clickable(onClick = onCancel), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Close, "Cancel", tint = Color.White, modifier = Modifier.size(26.dp))
                }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier.size(52.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable(enabled = bmp != null && !saving) {
                        saving = true
                        scope.launch {
                            val bytes = withContext(Dispatchers.Default) {
                                encodeCrop(bmp!!, cropSquare(bmp.width, bmp.height, viewportPx, zoom, offset.x, offset.y))
                            }
                            onDone(bytes)
                        }
                    },
                    contentAlignment = Alignment.Center
                ) {
                    if (saving) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                    else Icon(Icons.Outlined.Check, "Use photo", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(26.dp))
                }
            }
            Text(
                "Drag and pinch to adjust", color = Color.White.copy(alpha = 0.75f),
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 16.dp)
            )
        }
    }
}
