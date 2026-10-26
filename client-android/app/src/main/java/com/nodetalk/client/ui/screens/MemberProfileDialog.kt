package com.nodetalk.client.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.CoveApp
import com.nodetalk.client.data.model.CreateChannelRequest
import com.nodetalk.client.data.model.UserSummary
import com.nodetalk.client.ui.components.ButtonSize
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.CoveDialog
import com.nodetalk.client.ui.components.DialogSize
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.CoveTheme
import kotlinx.coroutines.launch

/**
 * Profile card for a member, opened by tapping an @mention (web `UserProfileModal`): avatar, name, status and a
 * "Message" button that opens (or creates) the direct message with them. [onOpenChat] receives the DM id and name.
 */
@Composable
fun MemberProfileDialog(
    userId: String,
    username: String,
    avatarId: String?,
    onDismiss: () -> Unit,
    onOpenChat: (channelId: String, name: String) -> Unit
) {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val me = app.preferencesManager.userId.orEmpty()
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf<UserSummary?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // There is no per-user endpoint: the user search returns the same summary the web profile shows.
    LaunchedEffect(userId) {
        app.apiClient.searchUsers(username).onSuccess { list -> profile = list.firstOrNull { it.id == userId } }
    }

    fun message() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            // The backend returns the existing DM when one already exists.
            app.apiClient.createChannel(CreateChannelRequest(name = "", members = listOf(me, userId), isPrivate = true)).fold(
                onSuccess = { onOpenChat(it.id, username) },
                onFailure = { error = it.message; busy = false }
            )
        }
    }

    CoveDialog(onDismiss = onDismiss, size = DialogSize.Sm) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            UserAvatar(userId, size = 88.dp, avatarId = profile?.avatarId ?: avatarId)
            Spacer(Modifier.height(12.dp))
            Text(username, color = c.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            profile?.let { p ->
                Text(p.status.replaceFirstChar { it.uppercase() }, color = c.textMuted, fontSize = 13.sp)
                if (!p.customMsg.isNullOrBlank()) Text(p.customMsg, color = c.textPrimary, fontSize = 14.sp, textAlign = TextAlign.Center)
            }
            error?.let { Spacer(Modifier.height(8.dp)); ErrorBanner(it) }
            if (userId != me) {
                Spacer(Modifier.height(16.dp))
                CoveButton("Message", { message() }, Modifier.fillMaxWidth(), size = ButtonSize.Lg, loading = busy)
            }
        }
    }
}
