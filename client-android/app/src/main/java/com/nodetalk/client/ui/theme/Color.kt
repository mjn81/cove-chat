package com.nodetalk.client.ui.theme

import androidx.compose.ui.graphics.Color

// ── NodeTalk Dark Mode Tokens (1:1 from client-web/src/index.css) ─────────────
val NTBackgroundDark = Color(0xFF313338)         // --background: 223 7% 21% (Main chat canvas)
val NTCardDark = Color(0xFF2B2D31)               // --card / --secondary: 220 6% 18% (Channels, sidebar)
val NTPopoverDark = Color(0xFF1E1F22)            // --popover: 225 6% 13% (Server rail, inputs, dialogs)
val NTPrimary = Color(0xFF5865F2)                // --primary: 235 86% 65% (Discord / NodeTalk Blurple)
val NTPrimaryForeground = Color(0xFFFFFFFF)      // --primary-foreground
val NTAccentDark = Color(0xFF3F4147)             // --accent: 220 6% 26% (Hover / active item)
val NTTextPrimaryDark = Color(0xFFF2F3F5)        // --foreground: 220 13% 95%
val NTTextMutedDark = Color(0xFF949BA4)          // --muted-foreground: 215 14% 65% (Placeholders, subtle)
val NTDestructive = Color(0xFFFA777C)            // --destructive: 359 83% 66% (Red / end call / danger)
val NTBorderDark = Color(0xFF1E1F22)             // --border: 225 6% 13%

// ── Status Indicators ─────────────────────────────────────────────────────────
val NTStatusOnline = Color(0xFF23A55A)           // Online green
val NTStatusIdle = Color(0xFFF0B232)             // Away / Idle yellow
val NTStatusDnd = Color(0xFFF23F43)              // Do Not Disturb red
val NTStatusOffline = Color(0xFF80848E)          // Offline gray

// ── Mention Colors ────────────────────────────────────────────────────────────
val NTMentionBg = Color(0xFF3C2D13)
val NTMentionBorder = Color(0xFFE5A33D)

// ── NodeTalk Light Mode Tokens ────────────────────────────────────────────────
val NTBackgroundLight = Color(0xFFFFFFFF)        // --background
val NTCardLight = Color(0xFFF2F3F5)              // --card / --secondary
val NTPopoverLight = Color(0xFFFFFFFF)           // --popover
val NTTextPrimaryLight = Color(0xFF060607)       // --foreground
val NTTextMutedLight = Color(0xFF4E5058)         // --muted-foreground
val NTAccentLight = Color(0xFFE3E5E8)            // --accent
val NTBorderLight = Color(0xFFE3E5E8)            // --border

// ── Whisper Mode (Zero-Persistence E2EE Pitch Black) ─────────────────────────
val NTWhisperBg = Color(0xFF121212)
val NTWhisperCard = Color(0xFF1C1C1C)
val NTWhisperPopover = Color(0xFF141414)
val NTWhisperAccent = Color(0xFF292929)
val NTWhisperPrimary = Color(0xFFF2F2F2)
val NTWhisperTextMuted = Color(0xFF8C8C8C)

// ── Backward-compatible Aliases ──────────────────────────────────────────────
val NodeTalkDarkBg = NTBackgroundDark
val NodeTalkSurface = NTCardDark
val NodeTalkSurfaceElevated = NTAccentDark
val NodeTalkPrimary = NTPrimary
val NodeTalkTextPrimary = NTTextPrimaryDark
val NodeTalkTextSecondary = NTTextMutedDark
val NodeTalkOnline = NTStatusOnline
val NodeTalkDestructive = NTDestructive
