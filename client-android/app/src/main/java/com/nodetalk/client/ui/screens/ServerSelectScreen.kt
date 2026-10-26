package com.nodetalk.client.ui.screens

import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveType
import androidx.compose.material3.MaterialTheme
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.ButtonSize
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import com.nodetalk.client.ui.components.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.CoveApp
import com.nodetalk.client.ui.components.AppLanguage
import com.nodetalk.client.ui.components.CoveTextField
import com.nodetalk.client.ui.components.OpenSourceFooter
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.CovePopoverDark
import com.nodetalk.client.ui.theme.CovePrimaryForeground
import com.nodetalk.client.ui.theme.CoveStatusOnline
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Connection check state, mirrors `status` in client-web `ServerSelectionPage`. */
private enum class ConnectStatus { Idle, Checking, Success, Error }

/**
 * Prepends a scheme when the user typed a bare domain/host ("chat.example.com"),
 * matching the web/desktop server-selection step.
 */
private fun normalizeServerUrl(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    val withScheme =
        if (trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true)) trimmed
        else "http://$trimmed"
    return if (isEmulator()) withScheme.replace(Regex("//(localhost|127\\.0\\.0\\.1)(?=[:/]|$)"), "//10.0.2.2")
    else withScheme
}

/**
 * Inside the Android emulator "localhost" is the emulated device itself; the host
 * machine is reachable at the special alias 10.0.2.2, so dev servers typed as
 * localhost are rewritten there.
 */
private fun isEmulator(): Boolean =
    Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
        Build.MODEL.contains("Emulator") || Build.MODEL.contains("Android SDK built for") ||
        Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish") ||
        Build.PRODUCT.contains("sdk")

/**
 * First-run step where the user types their server's domain. Layout and copy follow
 * `client-web/src/pages/ServerSelectionPage.tsx` (see `client-android/design-reference/01-connect.png`).
 *
 * @param onServerConfigured called after `/api/version` answered and the URL was saved.
 */
@Composable
fun ServerSelectScreen(onServerConfigured: () -> Unit) {
    val prefs = CoveApp.instance.preferencesManager
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val c = CoveTheme.extendedColors

    var serverUrl by remember { mutableStateOf(prefs.serverUrl) }
    var status by remember { mutableStateOf(ConnectStatus.Idle) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val busy = status == ConnectStatus.Checking || status == ConnectStatus.Success

    fun connect() {
        if (serverUrl.isBlank() || busy) return
        status = ConnectStatus.Checking
        errorMessage = null
        val previous = prefs.serverUrl
        prefs.serverUrl = normalizeServerUrl(serverUrl)
        scope.launch {
            // ApiClient reads the base URL from prefs, so the candidate is saved first and rolled back on failure.
            val result = api.getVersion()
            if (result.isSuccess) {
                status = ConnectStatus.Success
                delay(800)
                onServerConfigured()
            } else {
                prefs.serverUrl = previous
                status = ConnectStatus.Error
                errorMessage = "Failed to connect to server. Check the address and try again."
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(c.chatCanvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Select a Server",
                color = c.textPrimary,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Where are we heading today?",
                color = c.textMuted,
                fontSize = CoveType.body.fontSize,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(24.dp))

            errorMessage?.let { StatusBanner(text = it, color = MaterialTheme.colorScheme.error) }
            if (status == ConnectStatus.Success) {
                StatusBanner(text = "Successfully connected!", color = CoveStatusOnline)
            }

            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = buildAnnotatedString {
                        append(AppLanguage.translate("SERVER ADDRESS"))
                        withStyle(SpanStyle(color = MaterialTheme.colorScheme.error)) { append(" *") }
                    },
                    color = c.textMuted,
                    fontSize = CoveType.caption.fontSize,
                    fontWeight = FontWeight.Bold
                )
                CoveTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    placeholder = "https://chat.example.com",
                    enabled = !busy,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Go,
                        autoCorrectEnabled = false
                    ),
                    keyboardActions = KeyboardActions(onGo = { connect() })
                )
            }

            Spacer(Modifier.height(16.dp))
            CoveButton(
                text = "Connect",
                onClick = { connect() },
                modifier = Modifier.fillMaxWidth(),
                size = ButtonSize.Lg,
                loading = status == ConnectStatus.Checking,
                enabled = serverUrl.isNotBlank() && !busy
            )

            Spacer(Modifier.height(24.dp))
            Text(
                text = "Cove stores your messages securely, but relies on the server for key " +
                    "management. Ensure you trust the host before sending sensitive data",
                color = c.textMuted.copy(alpha = 0.6f),
                fontSize = CoveType.caption.fontSize,
                lineHeight = 18.sp,
                fontStyle = FontStyle.Italic,
                textAlign = TextAlign.Center
            )
        }

        OpenSourceFooter(Modifier.align(Alignment.BottomCenter))
    }
}

/** Tinted bordered message box (`bg-<color>/10 border-<color>/20`) used for errors and success. */
@Composable
private fun StatusBanner(text: String, color: Color) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 16.dp)
            .background(color.copy(alpha = 0.1f), CoveShapes.md)
            .border(1.dp, color.copy(alpha = 0.2f), CoveShapes.md)
            .padding(12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = text, color = color, fontSize = CoveType.label.fontSize, textAlign = TextAlign.Center)
    }
}
