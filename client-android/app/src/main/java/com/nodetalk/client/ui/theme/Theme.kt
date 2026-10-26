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
data class CoveExtendedColors(
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
    val mentionBorder: Color,
    val success: Color,
    val warning: Color,
    val overlay: Color,
    val onOverlay: Color,
    val mediaBackground: Color
)

private val DarkExtendedColors = CoveExtendedColors(
    chatCanvas = CoveBackgroundDark,
    card = CoveCardDark,
    popover = CovePopoverDark,
    accent = CoveAccentDark,
    textPrimary = CoveTextPrimaryDark,
    textMuted = CoveTextMutedDark,
    border = CoveBorderDark,
    statusOnline = CoveStatusOnline,
    statusIdle = CoveStatusIdle,
    statusDnd = CoveStatusDnd,
    statusOffline = CoveStatusOffline,
    mentionBg = CoveMentionBg,
    mentionBorder = CoveMentionBorder,
    success = CoveSuccessDark,
    warning = CoveWarningDark,
    overlay = CoveOverlay,
    onOverlay = CoveOnOverlay,
    mediaBackground = CoveMediaBackground
)

private val LightExtendedColors = CoveExtendedColors(
    chatCanvas = CoveBackgroundLight,
    card = CoveCardLight,
    popover = CovePopoverLight,
    accent = CoveAccentLight,
    textPrimary = CoveTextPrimaryLight,
    textMuted = CoveTextMutedLight,
    border = CoveBorderLight,
    statusOnline = CoveStatusOnline,
    statusIdle = CoveStatusIdle,
    statusDnd = CoveStatusDnd,
    statusOffline = CoveStatusOffline,
    mentionBg = CoveMentionBg,
    mentionBorder = CoveMentionBorder,
    success = CoveSuccessLight,
    warning = CoveWarningLight,
    overlay = CoveOverlay,
    onOverlay = CoveOnOverlay,
    mediaBackground = CoveMediaBackground
)

val LocalCoveExtendedColors = staticCompositionLocalOf { DarkExtendedColors }

private val DarkColorScheme = darkColorScheme(
    primary = CovePrimary,
    onPrimary = CovePrimaryForeground,
    background = CoveBackgroundDark,
    onBackground = CoveTextPrimaryDark,
    surface = CoveCardDark,
    onSurface = CoveTextPrimaryDark,
    surfaceVariant = CovePopoverDark,
    onSurfaceVariant = CoveTextMutedDark,
    outline = CoveBorderDark,
    error = CoveDestructive
)

private val LightColorScheme = lightColorScheme(
    primary = CovePrimaryLight,
    onPrimary = CovePrimaryForegroundLight,
    background = CoveBackgroundLight,
    onBackground = CoveTextPrimaryLight,
    surface = CoveCardLight,
    onSurface = CoveTextPrimaryLight,
    surfaceVariant = CovePopoverLight,
    onSurfaceVariant = CoveTextMutedLight,
    outline = CoveBorderLight,
    error = CoveDestructiveLight
)

object CoveTheme {
    val extendedColors: CoveExtendedColors
        @Composable
        get() = LocalCoveExtendedColors.current
}

/** App-wide theme choice (persisted by SettingsScreen); dark by default like the web client. */
object ThemeSettings {
    var dark by mutableStateOf(true)
}

/** Vazirmatn variable font, the same face the web client ships (client-web/public). */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val CoveFontFamily = FontFamily(
    listOf(400, 500, 600, 700).map { w ->
        Font(
            R.font.vazirmatn,
            weight = FontWeight(w),
            variationSettings = FontVariation.Settings(FontVariation.weight(w))
        )
    }
)

private fun coveTypography(): Typography {
    val base = Typography()
    fun TextStyle.f() = copy(
        fontFamily = CoveFontFamily,
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
fun CoveTheme(
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

    val direction = if (com.nodetalk.client.ui.components.AppLanguage.isRtl) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr
    CompositionLocalProvider(
        LocalCoveExtendedColors provides extendedColors,
        androidx.compose.ui.platform.LocalLayoutDirection provides direction
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = coveTypography(),
            content = content
        )
    }
}
