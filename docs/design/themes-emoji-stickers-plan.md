# Plan: themes, emoji packs, stickers

Status: **approved by the user, implementation started.** Based on a read-only survey of the code on `next` (see "Where it plugs in").
Implementation is split into sessions at the end; each session works on its own branch and commits in small steps.

## 0. Decisions (all approved with the recommendations below)

| # | Decision | My recommendation |
|---|---|---|
| 1 | Default emoji style | Noto (Apache 2.0, complete, familiar). All five styles ship on the server; admins enable which ones users may choose. |
| 2 | Source of the default sticker packs | Two default packs, both approved after the user previewed them: **"Cove Basics"** = the 48 static Fluent 3D stickers (MIT; names in the preview page) and **"Cove Moves"** = up to 73 animated Noto emoji (CC BY 4.0), re-encoded as animated WebP at 256 px. Nothing was removed in the preview. |
| 3 | Theme names | Neutral names, never brand names. Palette only, no logos: Cove (current), "Violet Night" (Discord-like), "Skyline" (Telegram-like), "Crimson" (YouTube-like). Brand names in the UI invite trademark trouble. |
| 4 | User-made stickers | On by default with quotas; an admin switch turns it off; admins can remove any pack. |
| 5 | Server theme gallery | Later (phase 4). Version 1 shares themes as files in chat and via a settings page. |
| 6 | Telegram theme import | Best-effort converter in phase 4 (colours map approximately; the result is previewed before applying). |

## 1. Themes

### 1.1 Built-in themes
Cove (current terracotta), Violet Night, Skyline, Crimson (red and black), plus: Nord, Catppuccin (Mocha and Latte), Dracula, Solarized, Gruvbox, AMOLED Black, Paper (warm light). All are MIT or similarly permissive palettes, re-expressed in our tokens. Each theme has a dark and a light variant where it makes sense.

### 1.2 The file format: `.covetheme`
- A ZIP container with the extension `.covetheme` and mime `application/vnd.cove.theme+zip`. Contents: `theme.json` and an optional `assets/` folder (backgrounds, preview image).
- `theme.json` (schema version 1): `format: "cove-theme"`, `version`, `id`, `name` (en/fa/ar map), `author`, `license`, `base` (`dark` or `light`), `tokens` (our existing CSS tokens as HSL triplets, optional second set for the light variant), `chat` (background: `pattern` | `image` | `gradient` | `color`, asset path, opacity, blur, fit; bubble tint), `preview` (asset path).
- **Data only. No CSS, no JavaScript, no HTML, no fonts, no SVG.**

### 1.3 Security (themes must not be malware)
- Strict schema validation (zod on web, equivalent in Kotlin, a Go validator on the server for gallery uploads). Unknown keys are dropped, not applied.
- Only allow-listed token names; values must match `H S% L%` (HSL ranges clamped) or a strict hex. Applied with `style.setProperty` on the root, never concatenated into a stylesheet. The existing CSP (`style-src 'self' 'unsafe-inline'`, no remote CSS) stays unchanged.
- Images: PNG, JPEG, WebP only; magic bytes checked; decoded with `createImageBitmap` (reject on failure); at most 4096x4096 and 2 MB each, 8 MB total, 20 entries; shown through blob URLs.
- ZIP hardening: no path traversal, no absolute paths, no symlinks, no nested archives, compression-ratio and total-expanded-size limits.
- Readability guard: refuse (or auto-correct with a warning) token sets whose text/background contrast is below a minimum, so a theme cannot make the UI unusable or hide buttons.
- A theme can never change behaviour, only colours and backgrounds. Install and preview never auto-run on download.

### 1.4 UX
- Settings > Appearance > Themes page: built-ins, installed themes, "Import file", "Create / edit", "Export", "Share to chat".
- Editor: colour pickers with live preview, contrast warnings, background image upload with crop.
- **Sending a `.covetheme` file in chat shows a theme card** (name, author, colour strip, mini mock preview, buttons Preview and Install). Hook: `FileBubble` / `GenericFileBubble` branch on the decrypted metadata name or mime, the same way the invite card hooks into `MessageItem`.
- **Preview and revert:** a preview applies to a scoped override layer (precedent: the `.whisper-mode` palette override) with a floating bar "Previewing X: Apply or Revert". It auto-reverts after 60 seconds, on reload, or on Revert; only Apply persists.
- Storage per device (IndexedDB on web, app files on Android). Cross-device sync is a later decision.

### 1.5 Platform notes
- Web: tokens in `client-web/src/index.css`, theme toggle effect in `App.tsx:43-50`, store in `store/app.slice.ts` (localStorage `app-settings`), backgrounds in `AppearanceTab.tsx` and `ChatBackgroundPattern.tsx` (two duplicate id lists; unify). Non-tokenized colours (mac drag region, banner presets, sonner toasts) need tokenizing before a custom theme looks right.
- Android: colours are compile-time constants (`Color.kt`, `Theme.kt`, `ThemeSettings.dark` boolean). Needs a runtime mapper from tokens to `CoveExtendedColors` and the Material scheme, a Kotlin validator, and removal of code that branches on `ThemeSettings.dark` (`CoveFields.kt`, `ChannelListScreen.kt`).
- Desktop: the Wails `BackgroundColour` flash before load; the popup window gets the base mode today (`notification-popup.tsx`), so a custom theme's tokens must be passed in its payload.
- Telegram themes: `.tdesktop-theme` (a ZIP with `colors.tdesktop-theme` plus a background image) and Android `.attheme` (key=colour list) can be converted into `.covetheme` by a best-effort mapper (window background, text, primary button colours to our tokens). Preview before apply.

## 2. Emoji

### 2.1 Styles
Native (device font), Noto, Twemoji, Blobmoji, Fluent Flat, FxEmojis (OpenMoji dropped). Licences: Apache 2.0, CC BY 4.0, Apache 2.0, MIT, CC BY 4.0. An About/credits page carries the required attributions.

### 2.2 Size problem and the solution
Shipping the SVG sets raw would add about 120 MB or more (measured: Twemoji 10 MB, Fluent Flat 17 MB, FxEmojis about 33 MB; Noto and Blobmoji not measured, they are likewise tens of MB). Instead:
- A build script (`make emoji/build`) converts each style into one **WebP sprite sheet plus a JSON index** (code point to rectangle) at 64 px, target 2 to 5 MB per style, and checks the licence files in.
- **The server embeds all styles** (`go:embed`), so air-gapped servers need no internet, and serves them from `GET /api/packs/emoji/{style}/{version}/...` with immutable cache headers. The server binary grows by roughly 15 to 25 MB (to be measured in the first step; if too large, only the default style is embedded and the rest are downloaded by the admin).
- **Clients bundle only the default style** (about 3 to 5 MB, to be measured) and download others on demand, then cache them (IndexedDB on web, app files on Android). If a sheet is unavailable the client falls back to the native glyph. Clients stay small.
- Admin panel "Emoji and stickers" tab: tick which styles are available, pick the server default. Users pick their own style among the enabled ones (per device at first).

### 2.3 Rendering
- Text stays plain Unicode on the wire. Clients replace emoji with sprite images at render time (Intl.Segmenter or emoji-regex), keeping the original character as alt text so copy and paste still gives Unicode. Applies to messages, reactions, picker and previews.
- Web: swap the picker data source to our packs (emoji-mart supports custom categories); lazy-load the picker (the 420 KB data file is currently in the main chunk). Android: custom `EmojiPanel` renders from the sheets.

### 2.4 Custom emoji
- Admin uploads (name, image) into the server custom set; PNG, WebP or GIF, at most 256 KB and 128x128 after normalisation; names unique per server.
- Sent as the shortcode `:name:` inside ordinary text; clients resolve it from the server set. A client that does not know the pack shows the text. New tokenizer rule next to mention/url/email in `MessageItem.tsx`. Capability `custom_emoji`.

### 2.5 Big animated emoji in chat (like Telegram)
- When a message consists of **exactly one emoji** (ignoring whitespace; skin tones, variation selectors and ZWJ sequences count as one) **and an animated version exists**, the chat shows the animated image large (about 128 px) instead of a tiny glyph, without a bubble background. Tapping it replays the animation.
- One emoji without an animation, or two to three emoji, are shown "jumbo" (large static image of the active style); four or more are normal text size.
- It is purely client-side rendering: the message stays plain Unicode text on the wire, so old clients, search and copy/paste are unaffected and no new message type is needed.
- The animated set is the same "Cove Moves" Noto animations served by the pack endpoints (`animated emoji` capability), downloaded lazily and cached; a code point sequence to animation-id table ships with the pack.
- Settings: "Animated emoji" switch (on by default), off when the OS reduces motion or the device is in data-saver mode; falls back to the static jumbo emoji.
- Same rule on web, desktop (shared UI) and Android.

## 3. Stickers

### 3.1 Model
- A **pack** has id, name, kind (`server` or `user`), owner, items (image file id, emoji it maps to, order), version, licence/attribution, enabled and default flags.
- Server packs (admin-managed, one default pack) appear for every user automatically. User packs belong to their creator; others can add a user pack from a share card.
- Pack list endpoint, pack detail, create/update/delete, item upload; stored in Badger via `internal/store`; routes behind `protect` or `protectAdmin`; Swagger and tests per the backend rules. Capability `stickers`.

### 3.2 Sending
- New message type `sticker` (added to every list the survey found: `models.MessageType` and `Valid()`, `message-types.ts`, `types/api.ts`, `ws.ts`, forward rules, Android `ApiStandard.kt`, `docs/api-standard.md` section 5). Body JSON `{ pack_id, sticker_id, file_id }`, validated by a `validateStickerMessage` modelled on `ws/invite.go` (pack exists, sender may use it, file belongs to the pack). Old clients show the placeholder for unknown types.
- Sticker images are **channel-less files** (like avatars): readable by any signed-in user who knows the unguessable file id, so recipients in any channel can load them. This is the stated privacy trade-off; the alternative (re-encrypt per channel on every send) is heavy.

### 3.3 User-made stickers
- Create a pack, add images: client crop/resize to 512x512 (reuse `ImageEditor`), WebP, static or short animated; at most 512 KB each.
- Server checks magic bytes and size; optionally normalises through ffmpeg (already used for video) so animated formats are bounded. SVG is never accepted.
- Quotas (admin-configurable): packs per user, stickers per pack, total bytes. Admin switch to disable user uploads; admin can delete packs and see them in the audit log. Cleanup of files when a pack is deleted (files are not garbage collected today).
- Share a pack as a card in chat (like invite cards) with an "Add" button.

### 3.4 Default pack
"Cove Basics" (static, 48 stickers) and "Cove Moves" (animated, up to 73), decision 2. Built by a script from the chosen art into WebP (512 px for static stickers, 256 px animated WebP for the animated ones), embedded in the server like the emoji styles, with attribution on the credits page.

## 4. Where it plugs in (from the survey)
- Message types: `backend/internal/models/models.go`, `ws/handlers.go`, `ws/invite.go`, `client-web/src/domains/channels/utils/invite-message.ts`, `components/Chat/InviteMessage.tsx`, `MessageItem.tsx`.
- Files: `backend/internal/api/files.go` (`allowedUploadMIMETypes`, channel-less files, ffmpeg), `storage/`, `client-web/src/utils/file.ts`, `api/client.ts`.
- Admin and settings: `config/schema.go`, `api/settings.go`, `api/server_info.go`, `api/version.go` and `apistd.Capabilities`, `client-web/src/domains/admin/components/admin-tab.tsx`.
- Android: `ui/theme/*`, `data/local/PreferencesManager.kt`, `ChatInputBar.kt` (`EmojiPanel`), `ChatScreen.kt`, `ApiStandard.kt`, `docs/android-parity.md`.
- Everything gated by capabilities so old clients and servers degrade gracefully; en/fa/ar strings with RTL on every new screen.

## 5. Implementation sessions (after you approve)
Each session starts from `next`, works on its own branch, commits in small steps and never pushes.

1. **Themes A (web):** engine, token allow-list, the eleven built-in themes, settings page, `.covetheme` parser/validator with security tests, tokenizing leftover hard-coded colours.
2. **Themes B (web):** chat theme card, preview and revert bar, editor with contrast checks, background images, export and share.
3. **Packs backend:** pack model and store, emoji and sticker endpoints, embedded styles and `make emoji/build`, limits, admin settings, capabilities, tests and Swagger.
4. **Emoji and stickers (web):** renderer and picker, admin tab, custom emoji, sticker picker, pack manager, creation flow, chat bubble and share card.
5. **Android parity:** themes runtime mapper and validator, emoji sheets and panel, stickers, with emulator checks.
6. **Desktop and polish:** popup theme payload, background flash, credits page.
7. **Phase 4:** Telegram importer and server theme gallery.

Sessions 1 and 3 can run in parallel; 2 and 4 follow them; 5 follows 1 to 4.
