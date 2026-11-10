package com.cove.chat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.cove.chat.ui.theme.CoveTheme

/** What the connection indicator shows: link state first, then heartbeat latency (same buckets as client-web `connectionLevel`). */
enum class ConnectionLevel { Offline, Measuring, Good, Average, Poor }

/** Resolves the indicator level: under 100 ms feels instant, above 250 ms conversation starts to lag. */
fun connectionLevel(connected: Boolean, latencyMs: Int?): ConnectionLevel = when {
    !connected -> ConnectionLevel.Offline
    latencyMs == null -> ConnectionLevel.Measuring
    latencyMs < 100 -> ConnectionLevel.Good
    latencyMs < 250 -> ConnectionLevel.Average
    else -> ConnectionLevel.Poor
}

/** How many of the three bars are lit for [level]. */
fun connectionBars(level: ConnectionLevel): Int = when (level) {
    ConnectionLevel.Offline -> 0
    ConnectionLevel.Measuring, ConnectionLevel.Poor -> 1
    ConnectionLevel.Average -> 2
    ConnectionLevel.Good -> 3
}

/** Three signal bars for the server connection, coloured by quality. */
@Composable
fun ConnectionSignal(connected: Boolean, latencyMs: Int?, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    val level = connectionLevel(connected, latencyMs)
    val lit = connectionBars(level)
    val tint = when (level) {
        ConnectionLevel.Good, ConnectionLevel.Measuring -> c.success
        ConnectionLevel.Average -> c.warning
        ConnectionLevel.Poor, ConnectionLevel.Offline -> MaterialTheme.colorScheme.error
    }
    Row(modifier.height(12.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        for (i in 1..3) {
            Box(
                Modifier.width(3.dp).fillMaxHeight(i / 3f).clip(RoundedCornerShape(1.dp))
                    .background(if (i <= lit) tint else c.textMuted.copy(alpha = 0.3f))
            )
        }
    }
}
