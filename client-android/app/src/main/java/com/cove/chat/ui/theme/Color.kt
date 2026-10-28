package com.nodetalk.client.ui.theme

import androidx.compose.ui.graphics.Color

// ── Cove Dark Mode Tokens (mirrors client-web/src/index.css) ─────────────
val CoveBackgroundDark = Color(0xFF23201F)         // --background (Main chat canvas)
val CoveCardDark = Color(0xFF2E2A29)               // --card / --secondary (Channels, sidebar)
val CovePopoverDark = Color(0xFF1B1918)            // --popover (Server rail, inputs, dialogs)
val CovePrimary = Color(0xFFD9826A)                // --primary (Terracotta (dark mode))
val CovePrimaryForeground = Color(0xFF2A140D)      // --primary-foreground
val CoveAccentDark = Color(0xFF3B3735)             // --accent (Hover / active item)
val CoveTextPrimaryDark = Color(0xFFE8E5E3)        // --foreground
val CoveTextMutedDark = Color(0xFFAEA7A3)          // --muted-foreground (Placeholders, subtle)
val CoveDestructive = Color(0xFFE5707A)            // --destructive (Red / end call / danger)
val CoveBorderDark = Color(0xFF46413E)             // --border

// ── Status Indicators ─────────────────────────────────────────────────────────
val CoveStatusOnline = Color(0xFF23A55A)           // Online green
val CoveStatusIdle = Color(0xFFF0B232)             // Away / Idle yellow
val CoveStatusDnd = Color(0xFFF23F43)              // Do Not Disturb red
val CoveStatusOffline = Color(0xFF80848E)          // Offline gray

// ── Mention Colors ────────────────────────────────────────────────────────────
val CoveMentionBg = Color(0xFF3B2E17)
val CoveMentionBorder = Color(0xFFF5C265)

// ── Cove Light Mode Tokens ────────────────────────────────────────────────
val CoveBackgroundLight = Color(0xFFFBF8F5)        // --background
val CoveCardLight = Color(0xFFF3EEE9)              // --card / --secondary
val CovePopoverLight = Color(0xFFFDFBF9)           // --popover
val CoveTextPrimaryLight = Color(0xFF2B2420)       // --foreground
val CoveTextMutedLight = Color(0xFF6F645B)         // --muted-foreground
val CoveAccentLight = Color(0xFFE9E1D9)            // --accent
val CoveBorderLight = Color(0xFFDDD3C9)            // --border

// ── Whisper Mode (Zero-Persistence E2EE Pitch Black) ─────────────────────────
val CoveWhisperBg = Color(0xFF121212)
val CoveWhisperCard = Color(0xFF1C1C1C)
val CoveWhisperPopover = Color(0xFF141414)
val CoveWhisperAccent = Color(0xFF292929)
val CoveWhisperPrimary = Color(0xFFF2F2F2)
val CoveWhisperTextMuted = Color(0xFF8C8C8C)

// ── Light-mode brand colours (white text on the deeper terracotta stays legible) ─
val CovePrimaryLight = Color(0xFFC4624A)           // --primary (light): #C4624A
val CovePrimaryForegroundLight = Color(0xFFFFFFFF)
val CoveDestructiveLight = Color(0xFFD63A3A)

// ── Semantic status colours (mirror --success / --warning / overlay in client-web/src/index.css) ─
val CoveSuccessDark = Color(0xFF58C48A)
val CoveSuccessLight = Color(0xFF2E9A55)
val CoveWarningDark = Color(0xFFF5C265)
val CoveWarningLight = Color(0xFF8A5A00)
/** Scrim over video / images; the same in both themes so white controls on top stay legible. */
val CoveOverlay = Color(0x99000000)
/** Icons / text drawn on top of [CoveOverlay] or live video. */
val CoveOnOverlay = Color(0xFFFFFFFF)
/** Letterbox behind video and full-screen photos. */
val CoveMediaBackground = Color(0xFF000000)
