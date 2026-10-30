package com.cove.chat.ui.screens

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.security.AppLock
import com.cove.chat.security.UnlockResult
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveMark
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType

/**
 * Full-screen cover shown while the passcode lock is engaged. It swallows every touch so nothing underneath can be
 * used, and Back sends the app to the background instead of leaving the lock. "Sign out" is the way out for a
 * forgotten passcode: it removes the account and the passcode from this phone.
 */
@Composable
fun LockScreen() {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    BackHandler(enabled = true) { (context as? Activity)?.moveTaskToBack(true) }

    fun submit() {
        if (code.isEmpty()) return
        error = when (val r = AppLock.unlock(code)) {
            UnlockResult.Success -> null
            UnlockResult.Incorrect -> "Incorrect passcode."
            is UnlockResult.Throttled -> "Too many attempts. Try again in ${r.seconds} s"
        }
        code = ""
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.chatCanvas)
            .pointerInput(Unit) { detectTapGestures { } }
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CoveMark(64.dp)
        Spacer(Modifier.height(16.dp))
        Text("Cove is locked", color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("Enter your passcode to continue.", color = c.textMuted, fontSize = CoveType.label.fontSize)
        Spacer(Modifier.height(20.dp))
        CoveTextField(
            value = code,
            onValueChange = { code = it; error = null },
            modifier = Modifier.fillMaxWidth(),
            placeholder = "Passcode",
            password = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            isError = error != null
        )
        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize)
        }
        Spacer(Modifier.height(16.dp))
        CoveButton(text = "Unlock", onClick = { submit() }, enabled = code.isNotEmpty(), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(24.dp))
        Text(
            "Sign out",
            color = c.textMuted,
            fontSize = CoveType.label.fontSize,
            modifier = Modifier.clickable { CoveApp.instance.endSessionLocally() }.padding(8.dp)
        )
    }
}
