package com.nodetalk.client.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import com.nodetalk.client.ui.components.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.data.model.LoginRequest
import com.nodetalk.client.data.model.RegisterRequest
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FieldLabel
import com.nodetalk.client.ui.components.NTPrimaryButton
import com.nodetalk.client.ui.components.NTTextField
import com.nodetalk.client.ui.components.OpenSourceFooter
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.launch

/**
 * Login + register, matching `client-web` LoginPage / RegisterPage (reference: design-reference/02-login.png,
 * 03-register.png). Registration signs the user in straight away like the web flow does.
 *
 * @param onLoginSuccess called once a Bearer token is stored and the socket is connecting.
 * @param onChangeServer returns to the first-run server step (the web desktop "Connecting to … Change" footer).
 */
@Composable
fun LoginScreen(onLoginSuccess: () -> Unit, onChangeServer: () -> Unit) {
    val app = NodeTalkApp.instance
    val api = app.apiClient
    val prefs = app.preferencesManager
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val c = NodeTalkTheme.extendedColors

    var isRegister by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (loading) return
        if (username.isBlank() || password.isBlank()) {
            error = "Please enter both username and password."
            return
        }
        loading = true
        error = null
        scope.launch {
            val name = username.trim()
            val result = if (isRegister) {
                api.register(RegisterRequest(name, password)).fold(
                    onSuccess = { api.login(LoginRequest(name, password)) },
                    onFailure = { Result.failure(it) }
                )
            } else {
                api.login(LoginRequest(name, password))
            }
            loading = false
            result.fold(
                onSuccess = {
                    app.webSocketManager.connect()
                    onLoginSuccess()
                },
                onFailure = { error = it.message ?: "Authentication failed." }
            )
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(c.chatCanvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                if (isRegister) "Create an account" else "Welcome back!",
                color = c.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                if (isRegister) "Join NodeTalk and start chatting." else "We're so excited to see you again!",
                color = c.textMuted, fontSize = 16.sp, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(24.dp))

            error?.let {
                ErrorBanner(it, Modifier.padding(bottom = 16.dp))
            }

            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FieldLabel("Username", required = true)
                NTTextField(
                    value = username,
                    onValueChange = { username = it },
                    enabled = !loading,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Text, imeAction = ImeAction.Next, autoCorrectEnabled = false
                    ),
                    keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) })
                )
            }
            Spacer(Modifier.height(16.dp))
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FieldLabel("Password", required = true)
                NTTextField(
                    value = password,
                    onValueChange = { password = it },
                    enabled = !loading,
                    password = true,
                    revealed = showPassword,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password, imeAction = ImeAction.Go, autoCorrectEnabled = false
                    ),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                    trailing = {
                        Icon(
                            imageVector = if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            contentDescription = if (showPassword) "Hide password" else "Show password",
                            tint = c.textMuted,
                            modifier = Modifier.clickable { showPassword = !showPassword }
                        )
                    }
                )
            }

            Spacer(Modifier.height(16.dp))
            NTPrimaryButton(
                text = if (isRegister) "Continue" else "Log In",
                onClick = { submit() },
                loading = loading
            )

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                if (!isRegister) Text("Need an account? ", color = c.textMuted, fontSize = 14.sp)
                Text(
                    text = if (isRegister) "Already have an account?" else "Register",
                    color = NTPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable(enabled = !loading) {
                        isRegister = !isRegister
                        error = null
                    }
                )
            }

            Spacer(Modifier.height(24.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Connecting to: ${prefs.serverUrl}",
                    color = c.textMuted.copy(alpha = 0.6f),
                    fontSize = 11.sp,
                    fontStyle = FontStyle.Italic,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    "Change",
                    color = NTPrimary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable(onClick = onChangeServer).padding(start = 8.dp)
                )
            }
        }
        OpenSourceFooter(Modifier.align(Alignment.BottomCenter))
    }
}
