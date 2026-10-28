package com.cove.chat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme

/** A channel member that can be @-mentioned. */
data class MentionMember(val id: String, val username: String, val avatarId: String? = null)

/**
 * The partial @mention being typed at the end of [value], or null. Mirrors client-web `detectMention`: an `@` only
 * starts a mention at the start of the text or after whitespace (so `a@b.co` does not), and it ends at the first space.
 */
fun detectMention(value: String): String? {
    val at = value.lastIndexOf('@')
    if (at == -1) return null
    if (at != 0 && !value[at - 1].isWhitespace()) return null
    val query = value.substring(at + 1)
    return if (query.any { it.isWhitespace() }) null else query
}

/** Replaces the partial mention at the end of [value] with `@username ` (mirrors client-web `applyMention`). */
fun applyMention(value: String, username: String): String = value.substring(0, value.lastIndexOf('@')) + "@$username "

/** Members matching [query] (null = everyone), excluding yourself, prefix matches first. */
fun filterMentionMembers(members: List<MentionMember>, selfId: String, query: String?): List<MentionMember> {
    val needle = query.orEmpty().lowercase()
    return members.filter { it.id != selfId && it.username.lowercase().contains(needle) }
        .sortedBy { if (it.username.lowercase().startsWith(needle)) 0 else 1 }
}

/** Member list shown above the composer while typing an @mention, like the web `MentionPopup`. */
@Composable
fun MentionSuggestions(query: String, members: List<MentionMember>, onPick: (MentionMember) -> Unit, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clip(CoveShapes.md)
            .border(1.dp, c.border, CoveShapes.md)
            .background(c.popover)
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.AlternateEmail, null, tint = c.textMuted, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (query.isEmpty()) "Members" else "Members matching \"$query\"", color = c.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
            members.forEach { m ->
                Row(
                    Modifier.fillMaxWidth().clickable { onPick(m) }.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    UserAvatar(m.id, size = 28.dp, avatarId = m.avatarId)
                    Spacer(Modifier.width(10.dp))
                    Text(m.username, color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                }
            }
            if (members.isEmpty()) Text("No members found", color = c.textMuted, fontSize = 14.sp, modifier = Modifier.padding(12.dp))
        }
    }
}
