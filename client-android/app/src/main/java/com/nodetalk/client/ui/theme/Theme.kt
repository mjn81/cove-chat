package com.nodetalk.client.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.material3.Typography
import androidx.compose.ui.unit.em
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import android.app.Activity
import com.nodetalk.client.R
import androidx.compose.ui.graphics.Color

@Immutable
data class NodeTalkExtendedColors(
    val chatCanvas: Color,
    val card: Color,
    val popover: Color,
    val accent: Color,
    val textPrimary: Color,
    val textMuted: Color,
    val border: Color,
    val statusOnline: Color,
    val statusIdle: Color,
    val statusDnd: Color,
    val statusOffline: Color,
    val mentionBg: Color,
    val mentionBorder: Color
)

private val DarkExtendedColors = NodeTalkExtendedColors(
    chatCanvas = NTBackgroundDark,
    card = NTCardDark,
    popover = NTPopoverDark,
    accent = NTAccentDark,
    textPrimary = NTTextPrimaryDark,
    textMuted = NTTextMutedDark,
    border = NTBorderDark,
    statusOnline = NTStatusOnline,
    statusIdle = NTStatusIdle,
    statusDnd = NTStatusDnd,
    statusOffline = NTStatusOffline,
    mentionBg = NTMentionBg,
    mentionBorder = NTMentionBorder
)

private val LightExtendedColors = NodeTalkExtendedColors(
    chatCanvas = NTBackgroundLight,
    card = NTCardLight,
    popover = NTPopoverLight,
    accent = NTAccentLight,
    textPrimary = NTTextPrimaryLight,
    textMuted = NTTextMutedLight,
    border = NTBorderLight,
    statusOnline = NTStatusOnline,
    statusIdle = NTStatusIdle,
    statusDnd = NTStatusDnd,
    statusOffline = NTStatusOffline,
    mentionBg = NTMentionBg,
    mentionBorder = NTMentionBorder
)

val LocalNodeTalkExtendedColors = staticCompositionLocalOf { DarkExtendedColors }

private val DarkColorScheme = darkColorScheme(
    primary = NTPrimary,
    onPrimary = NTPrimaryForeground,
    background = NTBackgroundDark,
    onBackground = NTTextPrimaryDark,
    surface = NTCardDark,
    onSurface = NTTextPrimaryDark,
    surfaceVariant = NTPopoverDark,
    onSurfaceVariant = NTTextMutedDark,
    outline = NTBorderDark,
    error = NTDestructive
)

private val LightColorScheme = lightColorScheme(
    primary = NTPrimary,
    onPrimary = NTPrimaryForeground,
    background = NTBackgroundLight,
    onBackground = NTTextPrimaryLight,
    surface = NTCardLight,
    onSurface = NTTextPrimaryLight,
    surfaceVariant = NTPopoverLight,
    onSurfaceVariant = NTTextMutedLight,
    outline = NTBorderLight,
    error = NTDestructive
)

object NodeTalkTheme {
    val extendedColors: NodeTalkExtendedColors
        @Composable
        get() = LocalNodeTalkExtendedColors.current
}

/** App-wide theme choice (persisted by SettingsScreen); dark by default like the web client. */
object ThemeSettings {
    var dark by mutableStateOf(true)
}

/** Vazirmatn variable font, the same face the web client ships (client-web/public). */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val NodeTalkFontFamily = FontFamily(
    listOf(400, 500, 600, 700).map { w ->
        Font(
            R.font.vazirmatn,
            weight = FontWeight(w),
            variationSettings = FontVariation.Settings(FontVariation.weight(w))
        )
    }
)

private fun nodeTalkTypography(): Typography {
    val base = Typography()
    fun TextStyle.f() = copy(
        fontFamily = NodeTalkFontFamily,
        lineHeight = 1.35.em,
        // Vazirmatn has tall, asymmetric ascent/descent; centre glyphs in the line box so text sits centred in inputs and bars.
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
    )
    return Typography(
        displayLarge = base.displayLarge.f(), displayMedium = base.displayMedium.f(), displaySmall = base.displaySmall.f(),
        headlineLarge = base.headlineLarge.f(), headlineMedium = base.headlineMedium.f(), headlineSmall = base.headlineSmall.f(),
        titleLarge = base.titleLarge.f(), titleMedium = base.titleMedium.f(), titleSmall = base.titleSmall.f(),
        bodyLarge = base.bodyLarge.f(), bodyMedium = base.bodyMedium.f(), bodySmall = base.bodySmall.f(),
        labelLarge = base.labelLarge.f(), labelMedium = base.labelMedium.f(), labelSmall = base.labelSmall.f()
    )
}

@Composable
fun NodeTalkTheme(
    darkTheme: Boolean = ThemeSettings.dark,
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val extendedColors = if (darkTheme) DarkExtendedColors else LightExtendedColors

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            // Bars are transparent (edge-to-edge); pick icon contrast from the theme.
            val window = (view.context as Activity).window
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !darkTheme
            controller.isAppearanceLightNavigationBars = !darkTheme
        }
    }

    CompositionLocalProvider(LocalNodeTalkExtendedColors provides extendedColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = nodeTalkTypography(),
            content = content
        )
    }
}
