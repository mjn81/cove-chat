package com.cove.chat.ui.screens

import com.cove.chat.data.serverUrlCandidates
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveType
import androidx.compose.material3.MaterialTheme
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.ButtonSize
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.BoxWithConstraints
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
import com.cove.chat.ui.components.Text
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
import com.cove.chat.CoveApp
import com.cove.chat.ui.components.AppLanguage
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.OpenSourceFooter
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CovePopoverDark
import com.cove.chat.ui.theme.CovePrimaryForeground
import com.cove.chat.ui.theme.CoveStatusOnline
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Connection check state, mirrors `status` in client-web `ServerSelectionPage`. */
private enum class ConnectStatus { Idle, Checking, Success, Error }

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
        scope.launch {
            // ApiClient reads the base URL from prefs, so each candidate is saved before probing and the
            // previous value is restored when none answers. Public domains are tried over https first.
            var reachable = false
            for (candidate in serverUrlCandidates(serverUrl)) {
                prefs.serverUrl = if (isEmulator()) candidate.replace(Regex("""//(localhost|127\.0\.0\.1)(?=[:/]|$)"""), "//10.0.2.2") else candidate
                if (api.getVersion().isSuccess) {
                    reachable = true
                    break
                }
            }
            if (reachable) {
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

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(c.chatCanvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
    ) {
        val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = maxHeight)
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = if (imeVisible) 16.dp else 88.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            com.cove.chat.ui.components.CoveMark(size = 72.dp)
            Spacer(Modifier.height(16.dp))
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

        if (!imeVisible) OpenSourceFooter(Modifier.align(Alignment.BottomCenter))
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
