# Android parity audit

Compared against `client-web/src`, `website/src/data/roadmap.yaml` and the backend's advertised capabilities.
"Present" was checked against the Android source (named in the Action column), not assumed. Items marked
**Added** were implemented in the `claude/android-parity-7afcd9` branch; none could be run on a device (see the
bottom).

| Feature | Web | Android before | Action |
|---|---|---|---|
| Multi-select message actions | yes | present (`MessageSelection.kt`, tested) | none |
| Forward any message (text, voice, files, video, invites) | yes | present (`Forward.kt`, `isForwardable`) | none |
| Invite cards with Join button | yes | present (`InviteCard.kt`) | none |
| Sharing invites gated on `invite_messages` | yes (`FriendPickerModal`) | missing: capability never checked | **Added**: notice plus disabled Send on servers without it |
| Inline audio player and playlist | yes | present (`VoicePlayer.kt`, `Playlist.kt`, tested) | none |
| Chat backgrounds | yes | present (`ChatBackground.kt`) | none |
| Profile photo gallery and cropper | yes | present (`AvatarGallery*.kt`, `AvatarCrop.kt`, tested) | none |
| Whisper and call alerts, sounds | yes | present (`res/raw` call ring and whisper request, channels in `Notifications.kt`) | none |
| Cove notification icon | yes | present (`ic_notification`) | none |
| Notifications show sender photo and name | yes | name only | **Added**: profile photo as the sender icon and large icon |
| Active devices, login notices (Cove system account) | yes | present (`DevicesPage.kt`, `isSystemChat`) | none |
| Account deletion with password | yes | present (`deleteAccount`) | none |
| API standard: `X-Cove-Client`, error envelope and codes, paged lists | yes | present (`ApiStandard.kt`, `ApiErrors.kt`, `Page.kt`, tested) | none |
| Soft and hard minimum client version gate | yes | present (`ClientOutdatedDialog.kt`) | none |
| Capability checks (`webrtc_sfu`, `raw_udp_*`) | yes | missing: calls on a `raw_udp` server failed silently | **Added**: `ApiStandard.callsNeedUdpClient` and a translated message on every call entry point (tested) |
| Auto-update (check, download, install, opt-in) | n/a (desktop has it) | present (`UpdateManager.kt`, `UpdateUi.kt`, tested) | none |
| Admin: overview, users, invites, audit log | yes | present (`AdminPage.kt`) | none |
| Admin: config editor incl. calls group and `voice.mode` | yes | present (schema driven); labels for the new `captcha.*` and `update.*` keys and the Updates group were missing | **Added** labels (en, fa, ar) |
| Admin: server update panel (online, password step-up) | yes | missing | **Added** (`AdminServerPanels.kt`) with progress and wait-until-back |
| Admin: offline update upload | yes | missing | **Added** (file picker, version, checksum, install) |
| Admin: owner-only Restart server | yes | missing | **Added**, on Overview and under the calls settings, with the Docker and unsupported reasons |
| Admin: notices to every user | yes | missing | **Added** (owner-only Notices tab, confirmation) |
| Admin: backup, restore, reset, delete server | yes | present (`DataPanel`) | none |
| Admin audit action labels for restart and update events | yes | missing | **Added** |
| Settings pages (Account, Friends, Privacy, Devices, Appearance, Notifications, Voice, Storage, Admin, Updates) | yes | present (`SettingsScreen.kt`) | none |
| Passcode lock | yes | present (`AppLock.kt`, `PasscodeSettings.kt`) | none |
| Language en, fa, ar and RTL | yes | present (`I18n.kt`, layout direction from language) | none; every new string has real fa and ar text |
| Light and dark themes | yes | present (`Theme.kt`) | none |
| Reactions, typing indicator | not on web either | not applicable | none |
| Markdown rendering | in progress on web (links only today) | link rendering present (`Linkify.kt`) | none |
| Replies, edit, delete, presence and status, mentions, search, file limits | yes | present | none |
| Desktop-only: notification popups, window chrome, desktop update dialog | desktop only | not applicable (system notifications and the Android updater cover it) | none |
| Encrypted UDP calls (`raw_udp`) | desktop and web gating | in progress in another session | out of scope; only the message above |

## Not verified

Checked on an emulator against a temporary backend (`webrtc` and `raw_udp`): login, chat list, admin Overview with
the update card and Restart card, Notices, notifications with the sender photo (expanded and collapsed), selection
and forward, Appearance, Arabic RTL, dark theme, and the call message on a `raw_udp` server.

Not checked: a real server update install, the offline upload, an actual restart, invite cards, the photo gallery
and cropper, Farsi screens, and anything needing a camera, microphone or real push.

## Also fixed

`CoveApp.kt` had a stray duplicate `private set` left by the legacy UDP removal that stopped the app from
compiling; removed.

## Themes, emoji and stickers (Android)

Implemented in `client-android` (`themes/`, `emoji/`, `ui/screens/{ThemesUi,EmojiPanel,StickerUi,EmojiSettings}.kt`):
eleven built-in palettes, `.covetheme` parser/validator/ZIP hardening (JVM-tested), theme picker, preview bar (60 s auto-revert),
chat theme card, share to chat, theme chat background (pattern/colour/gradient/image); bundled Noto emoji sheet with on-demand
styles from the server, inline sprites in messages, big animated / jumbo emoji, system-glyph fallback; Telegram-style panel with
Emoji and Stickers tabs, `sticker` message type, pack share card (`cove://stickers/<id>`).
Not done: bubble tint (Android rows have no bubbles), composer-field sprites (the field shows system glyphs), a "My stickers"
creation UI (API calls exist in `ApiClient`), a downloaded fallback style (the bundled Noto sheet is the fallback), emoji in
sidebar previews / headers (`EmojiLabel` exists, not yet wired), and the theme editor.
Verified by unit tests and `make android/build` only; the emulator was unusable here (System UI not responding), so no screenshots.

Phone pass: the panel is a keyboard-replacing box at the keyboard's height (no docked or full-sidebar mode on phones); touch
targets are at least 44 dp (emoji cells, category/pack bar, tone and clear buttons, theme and preview buttons); Emoji and
Stickers swipe as pager pages; the preview bar is capped at 560 dp wide and respects the navigation bar. Noto is always the
default style: the device font only appears when the user picks "Device emoji". A docked side panel for tablets
(WindowSizeClass Medium/Expanded) is not built. Still unverified on a device (emulator unusable).

## Cold start (Android)

`data/local/ClientCache.kt` + `BodyCache.kt`: the chat list, the last 50 messages per chat and decrypted bodies are saved in
`cacheDir/cove` (wiped on sign-out) and drawn immediately on the next start while the network refresh and socket connect run
in parallel; `CryptoManager` also keeps the imported `SecretKey` per channel and answers repeat decrypts from the body cache
(keyed by channel and nonce). Channel keys are still never persisted. Timings: unmeasured (emulator unusable).

## Bot API (Android)

Implemented in `client-android` (`bots/`, `ui/screens/{BotUi,BotsPages}.kt`, `ui/components/{BotBadge,I18nBots}.kt`), mirroring `client-web/src/domains/bots`:
BOT badge on messages, the members list and DM rows (`member_bots`); `bot` messages with a glass button grid (callback buttons post
`POST /api/channels/{id}/interactions` and show a spinner, then a check; URL buttons open only http/https links); slash-command
autocomplete when typing `/` and `/name option:value` parsed into typed interactions (choices and types validated client side, the
server validates again); the action menu that replaces the composer input (persistent and one-time variants, a dismiss button that
switches back to typing, a strip to bring a persistent menu back), live through the `keyboard_update` WebSocket event; Settings > Bots
(create, copy the token once, rotate, enable/disable, webhook, delete; follows the admin policy `can_create`) and a Bots section in the
channel settings (install with a permission consent text, remove, installed commands). Everything is hidden without the `bots`
capability, and older servers are unaffected. Pure logic is unit tested (`BotLogicTest`).

The glass style uses theme tokens only (translucent background, accent or primary or error tint, hairline border); Compose has no cheap
backdrop blur, so it is translucency without blur, which is also the web fallback. Not verified on a device or emulator.
Not done: per-option pickers for command options (typed text only), ephemeral replies, and the gateway `subscribe` event (not in v1).
