package com.cove.chat.ui.components

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalUriHandler
import com.cove.chat.data.remote.ApiStandard
import com.cove.chat.data.remote.ClientOutdatedState

/**
 * Shown over the whole app when the server refuses this build (HTTP 426 / `client_outdated`). It explains the
 * problem and links to the release page; nothing crashes and the user is never left with a vague failure.
 */
@Composable
fun ClientOutdatedDialog() {
    val min by ClientOutdatedState.minVersion.collectAsState()
    val required = min ?: return
    val uriHandler = LocalUriHandler.current
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Update Cove to continue") },
        text = {
            Text(
                buildString {
                    append("This server needs a newer version of Cove. Your version is too old to talk to it safely.")
                    if (required.isNotBlank()) append("\n\nMinimum supported version: $required")
                }
            )
        },
        confirmButton = { TextButton(onClick = { uriHandler.openUri(ApiStandard.RELEASES_URL) }) { Text("Update") } }
    )
}
