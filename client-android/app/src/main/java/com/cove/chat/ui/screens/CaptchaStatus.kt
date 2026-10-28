package com.cove.chat.ui.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType

/**
 * Progress line for the sign-up proof-of-work check. There is nothing for the user to do: the app solves the
 * challenge in the background (see `solveCaptcha`) and only offers a retry if that failed.
 *
 * @param solved the check finished and the register button can be used.
 * @param failed fetching or solving the challenge failed.
 * @param onRetry called when the user taps "Try again".
 */
@Composable
fun CaptchaStatus(solved: Boolean, failed: Boolean, onRetry: () -> Unit) {
    val c = CoveTheme.extendedColors
    Row(
        Modifier
            .fillMaxWidth()
            .border(1.dp, c.border, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically
    ) {
        when {
            solved -> Text("You are verified", color = c.success, fontSize = CoveType.label.fontSize)
            failed -> {
                Text("The check could not be completed.", color = c.textMuted, fontSize = CoveType.label.fontSize)
                Text(
                    "Try again",
                    color = c.textPrimary,
                    fontSize = CoveType.label.fontSize,
                    modifier = Modifier.clickable(onClick = onRetry)
                )
            }
            else -> {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = c.textMuted)
                Text("Checking that you are human…", color = c.textMuted, fontSize = CoveType.label.fontSize)
            }
        }
    }
}
