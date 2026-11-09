# Emoji, stickers and the emoji panel: client rules

What every client (web, desktop through the web build, Android) must do the same way. The server side is in
[packs-api.md](packs-api.md); this page is the client behaviour the web client implements in `client-web/src/domains/emoji`,
`domains/stickers` and `domains/messages` (panel). Android should mirror it.

## 1. Mapping an emoji to a sprite

- **Key**: the emoji's code points as lower-case hex joined by `-`, with every U+FE0F removed (`❤️` → `2764`,
  `👍🏽` → `1f44d-1f3fd`, `🇩🇪` → `1f1e9-1f1ea`). Implemented by `emojiKey()`.
- **Grapheme splitting**: `Intl.Segmenter` (Android: `BreakIterator` / ICU grapheme clusters). A skin tone, flag or ZWJ
  sequence is one unit. An "emoji" grapheme is one that has Emoji_Presentation, U+FE0F or U+20E3 (keycap). Digits, `#`, `©`
  without VS16 and letters are text.
- **Lookup**: `index.emoji[key]` gives `[x, y]`, the top-left pixel of a 64 px cell in `sheet.webp`.
- **Gaps**: no style covers everything. Noto lacks all flags (258), the 12 keycaps and ©️/®️; Blobmoji, Fluent and FxEmojis lack
  newer emoji. Resolution order for one emoji: **active style → fallback style (the other enabled style with the most emoji,
  normally Twemoji, which covers all 3,395 picker emoji and skin tones) → device glyph**. The fallback sheet is downloaded
  only when needed: at once if the active style lacks something in the ordinary categories or the recents, otherwise when
  flags or symbols are shown. Never leave a cell empty; the device glyph is the last resort only (older Windows and some
  WebViews cannot draw newer emoji, which is why the fallback style matters).
- The sheet must be **decoded before it counts as loaded** (otherwise cells are blank for a moment while the glyph is hidden).
- Test data: `client-web/src/domains/emoji/utils/sprite-coverage.test.ts` walks every emoji in `@emoji-mart/data`
  against the shipped indexes.

## 2. Showing text with emoji

- Text on the wire stays plain Unicode. Draw emoji as sprites at render time and keep the original character as the
  element's text (copy and selection give Unicode).
- **Size is relative to the font**: sprite side = **1.35 × font size** in message text (20 px next to 15 px text), 1.25 × in
  previews, reply quotes and headers. Do not use fixed pixel sizes for inline emoji, so desktop zoom and DPI match the web.
- Plain-text surfaces that show user text (sidebar preview, channel names, chat header, reply quotes, Whisper messages) all
  go through the same renderer. Surfaces without a session (OS notifications, the desktop popup window) show plain text.
- Custom emoji: `:name:` with `[a-z0-9_]{2,32}`, only when the name is in the server set; otherwise left as typed.

## 3. Big emoji (Telegram rules)

A message made only of emoji (whitespace ignored): exactly one emoji with an entry in `GET /api/emoji/animated` → **animated
256 px WebP shown at 128 px**, no bubble, tap replays; one emoji without animation or two to three emoji → **jumbo static**
(64 / 52 / 44 px for 1 / 2 / 3); four or more or any other text → normal. Custom emoji count as jumbo members, never
animated. "Animated emoji" off (or OS reduced motion) → jumbo static.

## 4. The composer must hold real Unicode

The input value is always real Unicode text (or `:name:`), never markup. Insert at the caret, replacing a selection, and put
the caret after the inserted text. Where the platform cannot draw an emoji natively, the web client draws the text twice:
the textarea text is made transparent (caret and selection stay) and a mirror layer draws the same text with sprites in
boxes as wide as the native glyphs. Android can render the sprites inline (spans/inline content) instead.

## 5. The panel

- **Content**: top tabs Emoji | Stickers (short underline under the active one); search row with skin-tone and style
  buttons; small muted category titles (not uppercase); dense grid; bottom bar of category icons with a rounded highlight on
  the section in view; recents row first, custom emoji next. Sticker tab: grid plus a bottom bar of recents and pack icons.
- **Skin tone**: six tones, one setting for the picker (emoji without tone variants keep their only form).
- **Grid columns come from the measured width**: `columns = clamp(floor(width / 40), 5, 12)` for emoji (default 9 before
  measurement); stickers `clamp(floor(width / 84), 3, 6)` (default 4). Cells share the width equally, row height 38 px,
  emoji drawn at 26 px; title height 30 px. Sections are virtualised (placeholder of exact height, cells rendered within
  600 px of the viewport).
- **Interaction**: clicking an emoji inserts it and the panel **stays open**; the panel never takes focus from the composer
  on a mouse press; it closes on a click outside, Escape or sending (popover only). Arrow keys, Home, End move between
  emoji (mirrored in RTL), Enter picks (focus stays in the panel after a keyboard pick). Recents update immediately
  (32 entries; only single emoji and `:name:` shortcodes are kept).
- **Warm-up**: load the active style's sheet and index, the animated table and the custom emoji at app start, and preload the
  panel code and emoji data in idle time; keep the panel mounted but hidden once opened.
- **Popover**: fixed-size box (preferred 380 × 440 dp, 420 wide on large windows), positioned relative to the emoji button
  above it (flipping below when needed), clamped inside the window, rendered **outside the composer's layout** so it can never
  push or resize the composer.
- **Docked side panel (wide windows)**: at ≥ 1100 px window width the panel can dock as a 340 px column to the right of
  the chat (toggle in the panel header; the choice and open state are remembered). It stays open while typing, has the same
  tabs, search and category bar, and sends input to the open chat's composer. Below 1100 px the dock is not shown and the
  emoji button opens the popover again.

## 6. Stickers and packs

- `sticker` message body `{pack_id, sticker_id, file_id}`; stored stickers are loaded from `/api/files/<file_id>`, built-in
  ones from the versioned item `url` of the pack detail. Sticker bubble 168 dp, no bubble background.
- Pack share card: a `text` message whose whole body is `cove://stickers/<pack_id>`; clients draw an "Add stickers" card.
- Errors come with stable codes (`pack_limit_reached`, `image_invalid`, ...): translate from the code, not the message.

## 7. Start-up

Show the app from cached state at once (saved user, cached channel list, cached decrypted messages) and verify the session
in the background; request the channel list and open the socket in parallel with the profile check; import each channel's
`CryptoKey` once; never block drawing on writes to the local cache.
