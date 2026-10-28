package com.cove.chat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Sizes
import com.cove.chat.ui.theme.Spacing
import com.cove.chat.ui.theme.ThemeSettings

/** Uppercase small label; [required] appends the red ` *` marker (web rule for required fields). */
@Composable
fun FieldLabel(text: String, required: Boolean = false) {
    Text(
        text = buildAnnotatedString {
            append(AppLanguage.translate(text).uppercase())
            if (required) withStyle(SpanStyle(color = MaterialTheme.colorScheme.error)) { append(" *") }
        },
        color = CoveTheme.extendedColors.textMuted,
        style = CoveType.caption,
        fontWeight = FontWeight.Bold
    )
}

/** Flat dark input (`bg-popover`, 40dp, radius 8) used on every form, optional trailing icon slot. */
@Composable
fun CoveTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    revealed: Boolean = false,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    height: Dp = Sizes.field
) {
    val c = CoveTheme.extendedColors
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = singleLine,
        textStyle = TextStyle(
            color = c.textPrimary, fontSize = CoveType.body.fontSize, lineHeight = 20.sp,
            lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
        ),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = if (password && !revealed) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = modifier
            .fillMaxWidth()
            .height(height),
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(height)
                    .clip(CoveShapes.md)
                    // In light mode popover == background, so inputs use the card tone plus a hairline border to stay visible.
                    .background(if (ThemeSettings.dark) c.popover else c.card)
                    .border(1.dp, if (isError) MaterialTheme.colorScheme.error else if (ThemeSettings.dark) c.popover else c.border, CoveShapes.md)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                leading?.let {
                    it()
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(placeholder, color = c.textMuted, fontSize = CoveType.body.fontSize, lineHeight = 20.sp, maxLines = 1)
                    }
                    inner()
                }
                trailing?.invoke()
            }
        }
    )
}

/**
 * Label + control + hint / error, the one form-row layout (web `FormField`). [required] appends the red ` *`;
 * [error] replaces [hint] and is shown in the destructive colour.
 */
@Composable
fun FormField(
    label: String,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    hint: String? = null,
    error: String? = null,
    content: @Composable () -> Unit
) {
    val c = CoveTheme.extendedColors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FieldLabel(label, required)
        content()
        when {
            error != null -> Text(error, style = CoveType.caption, color = MaterialTheme.colorScheme.error)
            hint != null -> Text(hint, style = CoveType.caption, color = c.textMuted)
        }
    }
}
