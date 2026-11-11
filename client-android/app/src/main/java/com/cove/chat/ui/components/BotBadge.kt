package com.cove.chat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.theme.CoveShapes

/** The BOT badge shown next to every bot name (messages, members, DM list, profile). Flat, primary-coloured. */
@Composable
fun BotBadge(modifier: Modifier = Modifier) {
    Text(
        "BOT",
        color = MaterialTheme.colorScheme.onPrimary,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier.clip(CoveShapes.sm).background(MaterialTheme.colorScheme.primary).padding(horizontal = 5.dp, vertical = 1.dp)
    )
}
