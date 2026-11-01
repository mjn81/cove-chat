# Roadmap execution plan

Status: **draft, order approved in principle.** Public items live in `website/src/data/roadmap.yaml` (with fa/ar translations). This file is the internal, detailed version: it also holds items kept off the public site.

Rule of thumb: finish a phase before starting the next. Within a phase, items are independent unless noted. Each item follows the project workflow (TDD on backend and pure frontend logic, Makefile targets, i18n in en/fa/ar).

## Phase 1: Small fixes

Platform tag: **W** web, **A** Android, **D** desktop (Wails), **B** backend.

| # | Item | Platforms | Notes / open questions |
|---|---|---|---|
| 1 | Fix the "no send" input height | W | Composer height when the send button is hidden/absent; reproduce first |
| 2 | Share link fix | D, A | Share/invite links broken on Wails and Android; probably the origin used to build the link |
| 3 | macOS window action buttons height | D | Title bar traffic-light inset/height on Mac |
| 4 | More SVG pattern backgrounds | W, A | Add patterns to the existing background picker; keep tokens theme-aware |
| 5 | Unify DM search UI | W, A | **Sentence was cut off in the brief; needs the intended outcome before starting** |
| 6 | Multi-select message actions (Telegram-style) | W, A | Replace per-message hover actions with a selection mode: select, then act (delete, forward, copy, react) from a top bar. Public roadmap item `selection-mode` |
| 7 | Android audio recorder: progress and recording animation | A | The top one (the in-composer recorder) |
| 8 | Custom notification icon | A, D | Use the Cove glyph |
| 9 | Android trust and signing fix | A | Align with the keystore decision in `release-and-demo-plan.md` |
| 10 | Uploaded audio plays inline, like images | W, A, B | Check backend content-type handling and the attachment renderer |

Suggested order (cheap and isolated first, then the larger UI change):
1, 3, 2, 8, 9 → 4, 10, 7 → 5 → 6 (largest; touches the message list on both clients).

## Phase 2: Foundations

These unblock later features, so they go before the big ones.

| # | Item | Why now |
|---|---|---|
| 0 | Standard API format and client/server mismatch handling | Bot API, auto-update and themes all need a stable contract. Scope: response envelope, API version header, minimum-client-version check, "update required" UX. **Scope when we reach it** |
| 1 | Auto-update (desktop, like Telegram; server via an admin button) | Depends on the release pipeline in `release-and-demo-plan.md` and on item 0 for version negotiation |

## Phase 3: Product features

| # | Item | Depends on |
|---|---|---|
| 2 | Multi-theme, custom themes, theme upload/download page | Token system in `index.css`; ties into small fix 4 |
| 7 | Native emoji, admin-chosen emoji sets, custom emoji upload | Files/storage; admin panel |
| 10 | Advanced markdown (Telegram-like) | Existing markdown work in progress |
| 12 | Email notifications | Config + admin panel; needs an SMTP design |
| 13 | PWA on web | Independent; also unlocks web push |
| 3 | Bot API | Item 0 (stable contract); decide bot auth model and rate limits |

## Phase 4: Calls and networking

| # | Item | Depends on |
|---|---|---|
| 5 | UDP router for video, screenshare, etc. | Today `internal/voice` is audio-only; decide whether this extends raw UDP or the SFU |
| 6 | Secure UDP with encryption in closed nets | Item 5 (design the packet format once) |
| 11 | In-app / server-wide calls instead of group links | SFU in `internal/rtc`; WS signaling |

## Internal-only items (not on the public roadmap)

| # | Item | Notes |
|---|---|---|
| 4 | Security update | Placeholder. **Scope later:** audit findings, hardening list, dependency review |
| 8 | Instant load of cached messages without decryption delay | Likely a decrypted-message cache in IndexedDB; must respect the encryption model, so needs a design check |
| 9 | Actual release on Reddit | Marketing task. Prerequisites: stable beta, demo server, landing page, download page |

## Very later

Relay server mode, iOS app, internode communication (the public roadmap already lists this as federation), UI redesign / improvement.

## Public roadmap mapping

| Public item id | Source |
|---|---|
| selection-mode, chat-backgrounds, audio-playback, notif-icon, android-trust | Phase 1 (6, 4, 10, 8, 9) |
| api-contract, auto-update | Phase 2 |
| themes, emoji, rich-markdown, email-notif, bot-api, pwa | Phase 3 |
| udp-media, secure-udp, in-app-calls | Phase 4 |
| relay-mode, ios, ui-redesign, federation | Very later |

The old `update-checks` item was replaced by `auto-update`.
