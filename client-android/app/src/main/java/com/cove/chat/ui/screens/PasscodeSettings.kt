package com.cove.chat.ui.screens

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.security.AppLock
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveChoiceList
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.FieldLabel
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.SectionHeader
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType

private enum class PasscodeMode { Idle, Set, Change, Remove }

/** Idle timeouts for auto-lock, in seconds (-1 = only when the app restarts). */
private val AutoLockOptions = listOf(
    "0" to "Immediately", "60" to "After 1 minute", "300" to "After 5 minutes", "3600" to "After 1 hour", "-1" to "Only when the app restarts"
)

/**
 * Settings > Privacy section for the local passcode: turn it on, change or remove it, pick the auto-lock timeout,
 * or lock right away. The passcode is stored only as a salted PBKDF2 hash (see [AppLock]).
 */
@Composable
fun PasscodeSettings() {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    val prefs = CoveApp.instance.preferencesManager
    var enabled by remember { mutableStateOf(AppLock.enabled) }
    var timeout by remember { mutableStateOf(prefs.lockTimeoutSeconds.toString()) }
    var mode by remember { mutableStateOf(PasscodeMode.Idle) }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var repeat by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    fun toast(msg: String) = I18nToast.make(context, msg, Toast.LENGTH_SHORT).show()
    fun reset() { mode = PasscodeMode.Idle; current = ""; next = ""; repeat = ""; error = null }

    fun submit() {
        if (mode != PasscodeMode.Set && !AppLock.verify(current)) { error = "Incorrect passcode."; return }
        if (mode == PasscodeMode.Remove) {
            AppLock.remove(); enabled = false; toast("Passcode turned off"); reset(); return
        }
        if (!AppLock.isValidNew(next)) { error = "Use at least 4 characters."; return }
        if (next != repeat) { error = "Passcodes don't match."; return }
        AppLock.setPasscode(next); enabled = true; toast("Passcode saved"); reset()
    }

    val password = KeyboardOptions(keyboardType = KeyboardType.Password)

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Spacer(Modifier.height(14.dp))
        SectionHeader("Local passcode")
        Text(
            "Lock Cove on this phone. You'll enter the passcode when you open the app or after it has been in the background. Screenshots are blocked while a passcode is set.",
            color = c.textMuted, fontSize = CoveType.label.fontSize
        )

        if (mode == PasscodeMode.Idle) {
            if (enabled) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CoveButton("Change passcode", { mode = PasscodeMode.Change }, variant = ButtonVariant.Secondary)
                    CoveButton("Turn off", { mode = PasscodeMode.Remove }, variant = ButtonVariant.Secondary)
                }
                CoveButton("Lock now", { AppLock.lock() }, variant = ButtonVariant.Outline, modifier = Modifier.fillMaxWidth())
                FieldLabel("Auto-lock")
                CoveChoiceList(AutoLockOptions, timeout) { v -> timeout = v; prefs.lockTimeoutSeconds = v.toInt() }
            } else {
                CoveButton("Set passcode", { mode = PasscodeMode.Set })
            }
        } else {
            if (mode != PasscodeMode.Set) {
                FieldLabel("Current passcode", required = true)
                CoveTextField(current, { current = it; error = null }, password = true, keyboardOptions = password, modifier = Modifier.fillMaxWidth())
            }
            if (mode != PasscodeMode.Remove) {
                FieldLabel("New passcode", required = true)
                CoveTextField(next, { next = it; error = null }, password = true, keyboardOptions = password, modifier = Modifier.fillMaxWidth())
                FieldLabel("Repeat new passcode", required = true)
                CoveTextField(repeat, { repeat = it; error = null }, password = true, keyboardOptions = password, modifier = Modifier.fillMaxWidth())
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CoveButton(if (mode == PasscodeMode.Remove) "Turn off" else "Save", { submit() })
                CoveButton("Cancel", { reset() }, variant = ButtonVariant.Ghost)
            }
        }
    }
}
