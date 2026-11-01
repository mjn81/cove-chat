package com.cove.chat.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.cove.chat.data.remote.AvatarCache
import com.cove.chat.ui.components.Text

/**
 * Full-screen gallery of a user's profile photos, like Telegram's: swipe between them, with "2 / 5" on top.
 *
 * @param photoIds the user's photo ids, main one first (see [galleryOf]).
 * @param startIndex which photo opens first.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun AvatarGalleryViewer(photoIds: List<String>, startIndex: Int = 0, onDismiss: () -> Unit) {
    if (photoIds.isEmpty()) return
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, photoIds.lastIndex)) { photoIds.size }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
                val id = photoIds[page]
                var photo by remember(id) { mutableStateOf(AvatarCache.peek(id)) }
                LaunchedEffect(id) { if (photo == null) photo = AvatarCache.load(id) }
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    photo?.let {
                        // The height follows the width, so a small bitmap is scaled up to the screen instead of drawn at its own size.
                        Image(it.asImageBitmap(), null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().aspectRatio(it.width.toFloat() / it.height))
                    } ?: CircularProgressIndicator(color = Color.White)
                }
            }
            Box(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp).size(44.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.4f)).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, "Close", tint = Color.White, modifier = Modifier.size(24.dp))
            }
            if (photoIds.size > 1) {
                Text(
                    "${pager.currentPage + 1} / ${photoIds.size}", color = Color.White,
                    modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 24.dp)
                )
            }
        }
    }
}
