package com.nodetalk.client.ui.screens

import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveType
import androidx.compose.material3.MaterialTheme
import com.nodetalk.client.ui.components.CoveListRow
import com.nodetalk.client.ui.theme.Spacing
import androidx.compose.foundation.layout.PaddingValues
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material3.Icon
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.mirrorInRtl
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.CoveApp
import com.nodetalk.client.ui.components.AppLanguage
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.CoveBackgroundDark
import com.nodetalk.client.ui.theme.CoveBackgroundLight
import com.nodetalk.client.ui.theme.CoveAccentDark
import com.nodetalk.client.ui.theme.CoveAccentLight
import com.nodetalk.client.ui.theme.CoveCardDark
import com.nodetalk.client.ui.theme.CoveCardLight
import com.nodetalk.client.ui.theme.CoveTextPrimaryDark
import com.nodetalk.client.ui.theme.CoveTextPrimaryLight
import com.nodetalk.client.ui.theme.ThemeSettings
import kotlinx.coroutines.launch

private enum class SettingsPage(val title: String, val icon: ImageVector) {
    Account("My Account", Icons.Outlined.Person),
    Friends("Friends", Icons.Outlined.Group),
    Privacy("Privacy & Safety", Icons.Outlined.Shield),
    Appearance("Appearance", Icons.Outlined.Palette),
    Notifications("Notifications", Icons.Outlined.Notifications),
    Voice("Voice & Video", Icons.Outlined.GraphicEq),
    Storage("Data & Storage", Icons.Outlined.Storage)
}

/**
 * Full-screen settings (reference: design-reference/15..17): menu of pages with a Log Out entry.
 * Appearance (theme) and My Account are functional; the other pages are not on mobile yet.
 */
@Composable
fun SettingsScreen(onClose: () -> Unit, onLogout: () -> Unit, onOpenChat: (String, String) -> Unit = { _, _ -> }, onStartWhisper: (String, String) -> Unit = { _, _ -> }) {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf<SettingsPage?>(null) }

    BackHandler(enabled = page != null) { page = null }

    fun logout() {
        scope.launch {
            app.apiClient.logout()
            app.webSocketManager.disconnect()
            app.preferencesManager.clearAuth()
            com.nodetalk.client.service.BackgroundConnection.sync(app)
            onLogout()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(if (page == null) c.card else c.chatCanvas)
            .navigationBarsPadding()
    ) {
        val current = page
        if (current == null) {
            Box(Modifier.fillMaxWidth().statusBarsPadding().padding(16.dp)) {
                Text("USER SETTINGS", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.CenterStart).padding(start = 8.dp))
                Box(
                    Modifier.align(Alignment.CenterEnd).size(36.dp).clip(CircleShape).background(c.chatCanvas.copy(alpha = 0.5f)).clickable(onClick = onClose),
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Outlined.Close, "Close", tint = c.textPrimary, modifier = Modifier.size(20.dp)) }
            }
            Column(Modifier.padding(horizontal = 12.dp)) {
                listOf(SettingsPage.Account, SettingsPage.Friends, SettingsPage.Privacy).forEach { item ->
                    CoveListRow(
                        title = item.title,
                        selected = item == SettingsPage.Account,
                        onClick = { page = item },
                        titleColor = if (item == SettingsPage.Account) c.textPrimary else c.textMuted,
                        contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.md),
                        leading = { Icon(item.icon, null, tint = if (item == SettingsPage.Account) c.textPrimary else c.textMuted, modifier = Modifier.size(22.dp)) }
                    )
                }
                Text("GROUPS", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 12.dp, top = 24.dp, bottom = 8.dp))
                listOf(SettingsPage.Appearance, SettingsPage.Notifications, SettingsPage.Voice, SettingsPage.Storage).forEach { item ->
                    CoveListRow(
                        title = item.title,
                        selected = item == SettingsPage.Account,
                        onClick = { page = item },
                        titleColor = if (item == SettingsPage.Account) c.textPrimary else c.textMuted,
                        contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.md),
                        leading = { Icon(item.icon, null, tint = if (item == SettingsPage.Account) c.textPrimary else c.textMuted, modifier = Modifier.size(22.dp)) }
                    )
                }
                Spacer(Modifier.height(24.dp))
                SectionDivider(Modifier.padding(horizontal = 4.dp))
                Row(
                    Modifier.fillMaxWidth().clickable { logout() }.padding(horizontal = 12.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Logout, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(16.dp))
                    Text("Log Out", color = MaterialTheme.colorScheme.error, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Medium)
                }
            }
        } else {
            Column(Modifier.fillMaxWidth().background(c.card).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clickable { page = null }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronLeft, "Back", tint = c.textPrimary, modifier = Modifier.size(26.dp).mirrorInRtl())
                }
                Text(AppLanguage.translate(current.title).uppercase(), color = c.textMuted, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold)
            }
            SectionDivider()
            }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
                Text(current.title, color = c.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(24.dp))
                when (current) {
                    SettingsPage.Appearance -> AppearancePage()
                    SettingsPage.Friends -> FriendsPage(onOpenChat, onStartWhisper)
                    SettingsPage.Account -> AccountSettings(onLogout = { logout() })
                    SettingsPage.Privacy -> PrivacySettings()
                    SettingsPage.Notifications -> NotificationSettings()
                    SettingsPage.Voice -> VoiceSettings()
                    SettingsPage.Storage -> StorageSettings()
                    else -> Text("This section isn't available on mobile yet.", color = c.textMuted, fontSize = CoveType.body.fontSize)
                }
            }
        }
    }
}

@Composable
private fun AppearancePage() {
    val c = CoveTheme.extendedColors
    val prefs = CoveApp.instance.preferencesManager

    Text("THEME", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(12.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        ThemeCard("Dark", dark = true, selected = ThemeSettings.dark, Modifier.weight(1f)) {
            ThemeSettings.dark = true; prefs.darkTheme = true
        }
        ThemeCard("Light", dark = false, selected = !ThemeSettings.dark, Modifier.weight(1f)) {
            ThemeSettings.dark = false; prefs.darkTheme = false
        }
    }
    Spacer(Modifier.height(32.dp))
    Text("LANGUAGE", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(12.dp))
    Column(Modifier.fillMaxWidth().clip(CoveShapes.md).border(1.dp, c.border, CoveShapes.md).padding(4.dp)) {
        listOf(Triple("en", "English", "English"), Triple("fa", "Persian", "فارسی"), Triple("ar", "Arabic", "العربية")).forEach { (code, name, native) ->
            val on = AppLanguage.code == code
            CoveListRow(
                title = name, subtitle = native, selected = on,
                onClick = { AppLanguage.code = code; prefs.language = code },
                contentPadding = PaddingValues(Spacing.md),
                trailing = if (on) ({ Icon(Icons.Outlined.Check, null, tint = MaterialTheme.colorScheme.primary) }) else null
            )
        }
    }
}

@Composable
private fun ThemeCard(label: String, dark: Boolean, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    // The mini preview always shows that theme's own palette, whichever theme is active.
    val canvas = if (dark) CoveBackgroundDark else CoveBackgroundLight
    val bar = if (dark) CoveAccentDark else CoveAccentLight
    val tile = if (dark) CoveCardDark else CoveCardLight
    val text = if (dark) CoveTextPrimaryDark else CoveTextPrimaryLight
    val muted = CoveTheme.extendedColors.textMuted
    Column(
        modifier
            .clip(CoveShapes.md)
            .background(tile)
            .border(2.dp, if (selected) MaterialTheme.colorScheme.primary else Color.Transparent, CoveShapes.md)
            .clickable(onClick = onClick)
            .padding(Spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(Modifier.fillMaxWidth().height(48.dp).clip(CoveShapes.sm).background(canvas).padding(Spacing.md)) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = Modifier.padding(start = 28.dp)) {
                Box(Modifier.fillMaxWidth(0.8f).height(5.dp).clip(CoveShapes.sm).background(bar))
                Box(Modifier.fillMaxWidth(0.55f).height(5.dp).clip(CoveShapes.sm).background(bar))
            }
            Box(Modifier.size(14.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
        }
        Spacer(Modifier.height(10.dp))
        Text(label, color = if (selected) text else muted, style = CoveType.body, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun AccountPage(onLogout: () -> Unit) {
    val c = CoveTheme.extendedColors
    val prefs = CoveApp.instance.preferencesManager
    Row(verticalAlignment = Alignment.CenterVertically) {
        UserAvatar(prefs.userId ?: "?", size = 64.dp)
        Spacer(Modifier.width(16.dp))
        Column {
            Text(prefs.username ?: "", color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold)
            Text(prefs.serverUrl, color = c.textMuted, fontSize = CoveType.label.fontSize)
        }
    }
    Spacer(Modifier.height(32.dp))
    Text(
        "Log Out", color = MaterialTheme.colorScheme.error, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Medium,
        modifier = Modifier.clickable(onClick = onLogout).padding(vertical = 8.dp)
    )
}
