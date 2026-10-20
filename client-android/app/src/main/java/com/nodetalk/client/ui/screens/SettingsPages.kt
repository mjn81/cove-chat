package com.nodetalk.client.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.data.model.AuthUser
import com.nodetalk.client.data.model.UpdateProfileRequest
import com.nodetalk.client.data.remote.AvatarCache
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FieldLabel
import com.nodetalk.client.ui.components.NTPrimaryButton
import com.nodetalk.client.ui.components.NTTextField
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

private val BannerPresets = listOf(
    "#5865F2", "#57F287", "#FEE75C", "#ED4245", "#EB459E", "#00A8FC", "#E67E22", "#9B59B6", "#1ABC9C"
)

private val StatusChoices = listOf(
    "auto" to "Auto", "online" to "Online", "away" to "Idle", "dnd" to "Do Not Disturb", "offline" to "Invisible"
)

private fun parseColor(hex: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(NTPrimary)

/** Row with a title, a caption and a switch (same switch colours as the web toggle). */
@Composable
private fun ToggleRow(title: String, caption: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(caption, color = c.textMuted, fontSize = 13.sp)
        }
        Switch(
            checked = checked, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = NTPrimary, checkedThumbColor = Color.White,
                uncheckedTrackColor = c.accent, uncheckedThumbColor = Color.White,
                uncheckedBorderColor = Color.Transparent, checkedBorderColor = Color.Transparent
            )
        )
    }
}

/** Vertical list of radio-style options; the selected one is outlined in the primary colour. */
@Composable
private fun ChoiceList(options: List<Pair<String, String>>, selected: String, enabled: Boolean = true, onSelect: (String) -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (id, label) ->
            val on = id == selected
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .border(1.dp, if (on) NTPrimary else c.border, RoundedCornerShape(6.dp))
                    .background(if (on) NTPrimary.copy(alpha = 0.12f) else Color.Transparent)
                    .clickable(enabled = enabled) { onSelect(id) }
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(label, color = if (on) c.textPrimary else c.textMuted, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Center-crops to a square, caps at 512px and re-encodes as WebP (what the web avatar cropper produces). */
private fun squareAvatarBytes(source: ByteArray): ByteArray? {
    val bmp = BitmapFactory.decodeByteArray(source, 0, source.size) ?: return null
    val side = minOf(bmp.width, bmp.height)
    val square = Bitmap.createBitmap(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side)
    val scaled = if (side > 512) Bitmap.createScaledBitmap(square, 512, 512, true) else square
    val out = ByteArrayOutputStream()
    val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
    scaled.compress(format, 85, out)
    return out.toByteArray()
}

/**
 * Settings > My Account: avatar, username, status message, banner colour, presence preference and password
 * (all sent through `PATCH /api/users/me`, same fields as client-web AccountTab).
 */
@Composable
fun AccountSettings(onLogout: () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    val app = NodeTalkApp.instance
    val prefs = app.preferencesManager
    val api = app.apiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var me by remember { mutableStateOf<AuthUser?>(null) }
    var username by remember { mutableStateOf(prefs.username.orEmpty()) }
    var customMsg by remember { mutableStateOf("") }
    var banner by remember { mutableStateOf("#5865F2") }
    var status by remember { mutableStateOf("auto") }
    var oldPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var avatarBusy by remember { mutableStateOf(false) }
    var avatarId by remember { mutableStateOf(prefs.avatarId) }

    fun apply(u: AuthUser) {
        me = u
        username = u.username
        customMsg = u.customMsg.orEmpty()
        banner = u.bannerColor?.takeIf { it.isNotBlank() } ?: "#5865F2"
        status = u.statusPreference.ifBlank { "auto" }
        avatarId = u.avatarId?.takeIf { it.isNotBlank() }
        prefs.avatarId = avatarId
        prefs.username = u.username
    }
    LaunchedEffect(Unit) { api.getMe().onSuccess { apply(it) } }

    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()

    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        avatarBusy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val src = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Couldn't read the image.")
                    val bytes = squareAvatarBytes(src) ?: error("That file isn't a supported image.")
                    val uploaded = api.uploadAvatar(bytes, "image/webp").getOrThrow()
                    val gallery = listOf(uploaded.id) + (me?.avatarIds ?: listOfNotNull(avatarId)).filter { it != uploaded.id }
                    api.updateProfile(UpdateProfileRequest(avatarId = uploaded.id, avatarIds = gallery.take(5))).getOrThrow()
                }
            }
            result.onSuccess { apply(it); avatarId?.let(AvatarCache::invalidate) }.onFailure { toast(it.message ?: "Couldn't update your photo.") }
            avatarBusy = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center) {
                UserAvatar(prefs.userId ?: "?", size = 72.dp, avatarId = avatarId)
            }
            Spacer(Modifier.width(16.dp))
            Column {
                Text(prefs.username ?: "", color = c.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(prefs.serverUrl, color = c.textMuted, fontSize = 13.sp)
                Text(
                    if (avatarBusy) "Uploading…" else "Change photo", color = NTPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable(enabled = !avatarBusy) { pickAvatar.launch("image/*") }.padding(vertical = 6.dp)
                )
            }
        }
        // Banner colour preview, as on the web profile card
        Box(Modifier.fillMaxWidth().height(36.dp).clip(RoundedCornerShape(6.dp)).background(parseColor(banner)))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BannerPresets.forEach { hex ->
                Box(
                    Modifier.size(26.dp).clip(CircleShape).background(parseColor(hex))
                        .border(2.dp, if (hex.equals(banner, true)) c.textPrimary else Color.Transparent, CircleShape)
                        .clickable { banner = hex }
                )
            }
        }

        error?.let { ErrorBanner(it) }
        FieldLabel("Username")
        NTTextField(username, { username = it })
        FieldLabel("Custom status")
        NTTextField(customMsg, { customMsg = it }, placeholder = "What's on your mind?")

        FieldLabel("Online status")
        ChoiceList(StatusChoices, status) { choice ->
            val previous = status
            status = choice
            scope.launch { api.updateProfile(UpdateProfileRequest(statusPreference = choice)).onFailure { status = previous; toast(it.message ?: "Couldn't change status.") } }
        }

        NTPrimaryButton("Save profile", loading = saving, onClick = {
            saving = true
            error = null
            scope.launch {
                val req = UpdateProfileRequest(
                    username = username.trim().takeIf { it != me?.username },
                    customMsg = customMsg.trim().takeIf { it != (me?.customMsg ?: "") },
                    bannerColor = banner.takeIf { !it.equals(me?.bannerColor ?: "#5865F2", true) }
                )
                api.updateProfile(req).fold(onSuccess = { apply(it); toast("Profile saved") }, onFailure = { error = it.message })
                saving = false
            }
        })

        FieldLabel("Change password")
        NTTextField(oldPassword, { oldPassword = it }, placeholder = "Current password", password = true)
        NTTextField(newPassword, { newPassword = it }, placeholder = "New password (min 8 characters)", password = true)
        NTPrimaryButton("Update password", enabled = oldPassword.isNotBlank() && newPassword.length >= 8, onClick = {
            scope.launch {
                api.updateProfile(UpdateProfileRequest(password = newPassword, oldPassword = oldPassword)).fold(
                    onSuccess = { oldPassword = ""; newPassword = ""; error = null; toast("Password updated") },
                    onFailure = { error = it.message }
                )
            }
        })

        Text(
            "Log Out", color = NTDestructive, fontSize = 16.sp, fontWeight = FontWeight.Medium,
            modifier = Modifier.clickable(onClick = onLogout).padding(vertical = 8.dp)
        )
    }
}

private val PermissionAll3 = listOf(
    "everyone" to "Everyone", "friends" to "Friends only", "nobody" to "Nobody"
)
private val PermissionAll2 = listOf("everyone" to "Everyone", "nobody" to "Nobody")

/** Settings > Privacy & Safety: who can add you to channels, DM you, or send friend requests. */
@Composable
fun PrivacySettings() {
    val c = NodeTalkTheme.extendedColors
    val api = NodeTalkApp.instance.apiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var channelAdds by remember { mutableStateOf("everyone") }
    var dm by remember { mutableStateOf("everyone") }
    var friendReq by remember { mutableStateOf("everyone") }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        api.getMe().onSuccess {
            channelAdds = it.allowChannelAdds?.ifBlank { null } ?: "everyone"
            dm = it.dmPermission?.ifBlank { null } ?: "everyone"
            friendReq = it.friendRequestPermission?.ifBlank { null } ?: "everyone"
        }
        loaded = true
    }

    fun save(req: UpdateProfileRequest, rollback: () -> Unit) {
        scope.launch {
            api.updateProfile(req).onFailure { rollback(); Toast.makeText(context, it.message ?: "Couldn't save.", Toast.LENGTH_SHORT).show() }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Choose who can reach you. Changes save immediately.", color = c.textMuted, fontSize = 14.sp)
        Spacer(Modifier.height(6.dp))
        FieldLabel("Who can add me to channels")
        ChoiceList(PermissionAll3, channelAdds, enabled = loaded) { v -> val old = channelAdds; channelAdds = v; save(UpdateProfileRequest(allowChannelAdds = v)) { channelAdds = old } }
        Spacer(Modifier.height(10.dp))
        FieldLabel("Who can message me")
        ChoiceList(PermissionAll3, dm, enabled = loaded) { v -> val old = dm; dm = v; save(UpdateProfileRequest(dmPermission = v)) { dm = old } }
        Spacer(Modifier.height(10.dp))
        FieldLabel("Who can send me friend requests")
        ChoiceList(PermissionAll2, friendReq, enabled = loaded) { v -> val old = friendReq; friendReq = v; save(UpdateProfileRequest(friendRequestPermission = v)) { friendReq = old } }
    }
}

/** Settings > Notifications: local notification switches plus the Android runtime permission. */
@Composable
fun NotificationSettings() {
    val c = NodeTalkTheme.extendedColors
    val prefs = NodeTalkApp.instance.preferencesManager
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(prefs.notificationsEnabled) }
    var sound by remember { mutableStateOf(prefs.notificationSound) }
    fun granted() = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    var systemAllowed by remember { mutableStateOf(granted()) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { systemAllowed = it }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ToggleRow("Message notifications", "Show a notification for new messages while the app is in the background.", enabled) {
            enabled = it; prefs.notificationsEnabled = it
        }
        ToggleRow("Sound", "Play a sound with each notification.", sound) { sound = it; prefs.notificationSound = it }
        if (!systemAllowed) {
            Text("Android notification permission is off.", color = NTDestructive, fontSize = 13.sp)
            Text(
                "Allow notifications", color = NTPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                modifier = Modifier.clickable { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ask.launch(Manifest.permission.POST_NOTIFICATIONS) }.padding(vertical = 8.dp)
            )
        } else {
            Text("Notifications arrive while NodeTalk is running; there is no push service on a self-hosted server.", color = c.textMuted, fontSize = 12.sp)
        }
    }
}

/** Settings > Voice & Video: call audio processing and permission status. */
@Composable
fun VoiceSettings() {
    val c = NodeTalkTheme.extendedColors
    val prefs = NodeTalkApp.instance.preferencesManager
    val context = LocalContext.current
    var noise by remember { mutableStateOf(prefs.noiseSuppression) }
    var echo by remember { mutableStateOf(prefs.echoCancellation) }
    var muted by remember { mutableStateOf(prefs.joinCallsMuted) }
    var micOk by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) }
    var camOk by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val askMic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { micOk = it }
    val askCam = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { camOk = it }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ToggleRow("Noise suppression", "Filter background noise from your microphone.", noise) { noise = it; prefs.noiseSuppression = it }
        ToggleRow("Echo cancellation", "Prevent your speakers from feeding back into the call.", echo) { echo = it; prefs.echoCancellation = it }
        ToggleRow("Join calls muted", "Start every call with your microphone off.", muted) { muted = it; prefs.joinCallsMuted = it }
        Spacer(Modifier.height(8.dp))
        FieldLabel("Permissions")
        PermissionRow("Microphone", micOk) { askMic.launch(Manifest.permission.RECORD_AUDIO) }
        PermissionRow("Camera", camOk) { askCam.launch(Manifest.permission.CAMERA) }
        Text("Audio devices follow the system output; use Android's media controls to switch to Bluetooth or speaker.", color = c.textMuted, fontSize = 12.sp)
    }
}

@Composable
private fun PermissionRow(name: String, granted: Boolean, onAsk: () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, color = c.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
        if (granted) Text("Allowed", color = c.statusOnline, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        else Text("Allow", color = NTPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onAsk).padding(8.dp))
    }
}

private fun dirSize(f: File): Long = if (f.isFile) f.length() else f.listFiles()?.sumOf { dirSize(it) } ?: 0L

private fun formatBytes(b: Long): String = when {
    b >= 1 shl 20 -> "%.1f MB".format(b / 1048576.0)
    b >= 1 shl 10 -> "%.0f KB".format(b / 1024.0)
    else -> "$b B"
}

/** Settings > Data & Storage: size of the on-device cache and a clear action. */
@Composable
fun StorageSettings() {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var size by remember { mutableStateOf(0L) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) { size = withContext(Dispatchers.IO) { dirSize(context.cacheDir) } }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Opened attachments are decrypted into a private cache on this device. Messages and keys are never stored here.", color = c.textMuted, fontSize = 14.sp)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).border(1.dp, c.border, RoundedCornerShape(6.dp)).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Cached data", color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Text(formatBytes(size), color = c.textMuted, fontSize = 13.sp)
            }
            Text(
                "Clear", color = NTDestructive, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable {
                    scope.launch {
                        withContext(Dispatchers.IO) { context.cacheDir.listFiles()?.forEach { it.deleteRecursively() } }
                        clearImageCache()
                        tick++
                    }
                }.padding(8.dp)
            )
        }
    }
}
