# Component reuse & cleanup plan (web, Android, desktop)

Goal: one shared component vocabulary, implemented once per platform, so screens are composed from the same
named pieces everywhere. Numbers below are grep counts from the current code (indicative, not exact).

## 1. What the audit found

### Web (`client-web/src`, ~19.5k lines of components)

| Problem | Evidence | Why it matters |
|---|---|---|
| Hand-rolled modals with unrelated styling | 16 files use `Dialog`, each with its own `DialogContent` class string (`max-w-md`, `bg-card/95 backdrop-blur-xl`, `rounded-2xl`, `rounded-3xl`, `p-0`, `p-6`...). 4 more use `fixed inset-0` directly. | Dialogs look different; glass/blur breaks the flat rule. |
| Hard-coded dark dialogs | `FriendPickerModal`, `ImageEditor`, `UserProfileModal` use `bg-zinc-950 border-zinc-800 text-zinc-100`. | **Broken in light mode and ignores the new theme.** Highest-priority visual bug. |
| Raw palette colours and hex | ~172 `bg/text/border-<palette>-NNN` uses and ~186 hex/rgb literals (most in `VoiceCallStage`, `FriendsTab`, `UserProfileModal`, `VideoMessageRecorderModal`, `LeftSidebar`). Some are legitimate black/white overlays on video. | New terracotta theme will not reach them. |
| Missing primitives | `components/ui` has only avatar, button, card, context-menu, dialog, dropdown-menu, input, label, resizable, scroll-area, sheet, slider, tooltip. No textarea, switch, badge, tabs, select, checkbox, separator, popover, sonner. | Everything missing is hand-built per screen. |
| Hand-built controls | Switches hand-built in `NotificationsTab` (`bg-green-500`, physical `left-1`, breaks RTL). ~16 raw `<input>`/`<textarea>` outside `ui/input` (only 7 files use it). ~140 raw `<button>`. Icon buttons repeat the same ~120-char class string with small variations. | Inconsistent hover/focus/size, no shared a11y. |
| `alert()` for errors | 7 calls (`ChatInputArea`, `ForwardModal`, `GroupSettingsModal`, `WhisperChatArea`, `AccountTab`, `VoiceRecorder`). | Rules require toasts with backend messages. |
| RTL violations | ~194 physical classes (`ml-`, `pr-`, `left-`, `text-left`, `border-l`, `rounded-l`...). | Arabic layout is wrong in those spots. |
| Oversized files | `VoiceCallStage` 990, `ChatInputArea` 963, `LeftSidebar` 921, `WhisperChatArea` 821, `VideoMessageRecorderModal` 816, `VoiceRecorder` 739, `AccountTab` 710, `FriendsTab` 632. Limit in rules is ~250. | Hard to reuse or test anything inside them. |
| Hygiene | ~105 `console.*` (rules: use `logger`), ~150 `any`, flat `components/` instead of `domains/`, only 4 files use React Query. | Rule drift. Lowest priority, do while touching files. |

### Android (`ui/`, ~6.1k lines)

Better shape than web. `components/Common.kt` already has `NTTextField`, `NTPrimaryButton`, `FieldLabel`, `ErrorBanner`,
`SectionDivider`, `StatusDot`, `UserAvatar`, `InitialsAvatar`. Gaps:

| Problem | Evidence |
|---|---|
| Dialog scaffold duplicated | 23 raw `Dialog(` calls over 9 files. `PanelDialog` exists but is **private** to `ChannelDialogs.kt`; `Whisper*Dialog`, `IncomingCallDialog`, `NewConversation`, search each re-style their own. |
| Private one-off components | `ToggleRow`, `SegmentButton`, `FilterChip`, `ConversationRow`/`PersonRow`/`ResultRow`/`MenuRow`/`PermissionRow` (all list rows), `ToolbarButton`, `RoundIconButton`, `ControlButton`, `CallButton` (all icon buttons), each in its own file. |
| No spacing/shape/type tokens | 9 different corner radii (8dp x37, 6dp x26, 4dp, 16dp, 12dp, 3dp, 5dp, 10dp, 32dp), ~155 literal `fontSize = N.sp`, ~100 literal paddings. |
| Raw colours | ~50 `Color(0x..)` / `Color.White` literals in screens (VideoBubble, ConversationSearchDialog, NewConversationDialog, CallScreen...). |
| Old naming | `CoveTheme`, `NTxxx`, `CoveExtendedColors`, `CoveApp`. |

### Desktop
Embeds the web build, so it inherits all web work. Only separate items: window title/icon (done), `isWails()`
branching stays in `lib/`. No component work of its own.

## 2. Shared component vocabulary (web name -> Android name)

Same names, same props, same variants on both platforms. Tokens: radius `sm 4 / md 8 / lg 12 / full`,
spacing 4-point scale, type roles (`title`, `body`, `caption`, `label`), semantic colours
`primary, secondary, muted, accent, destructive, success, warning, mention` (add `success`/`warning`
to both platforms; today green/yellow are hard-coded).

| Component | Variants / sizes | Web | Android |
|---|---|---|---|
| Button | default, secondary, outline, ghost, destructive; sm/md/lg; loading | `ui/button` (extend with `loading`) | `CoveButton` (replaces `NTPrimaryButton`) |
| IconButton | ghost, destructive, filled; sm/md | new `IconButton` over `Button size=icon` | `CoveIconButton` (replaces Toolbar/RoundIcon/Control/Call buttons) |
| TextField / Textarea | with `FormField` (label, required ` *`, hint, error) | `ui/input`, `ui/textarea`, `FormField` | `NTTextField` -> `CoveTextField` + `FormField` |
| Switch row | title, caption | `ui/switch` + `SettingRow` | `CoveSwitchRow` (from `ToggleRow`) |
| Dialog | sizes `sm / md / lg / media(full)`, header, body, footer actions | `ModalShell` over `ui/dialog` | `CoveDialog` (from `PanelDialog`) |
| ConfirmDialog | destructive flag | existing `ConfirmModal`, restyled | `CoveConfirmDialog` |
| Sheet / menu | bottom sheet, dropdown | `ui/sheet`, `ui/dropdown-menu` | `CoveMenu`, `CoveSheet` |
| ListRow | leading avatar/icon, title, subtitle, trailing | `ListRow` | `CoveListRow` (replaces 5 row types) |
| Chip / Segmented / Tabs | selected state, count badge | `ui/tabs`, `Badge`, `SegmentedControl` | `CoveChip`, `CoveSegmented` |
| Avatar (+status dot) | sizes | `Avatar` (keep) + `StatusDot` | `UserAvatar` + `StatusDot` (keep) |
| EmptyState, Banner, Toast | info/error/success | `EmptyState`, `ui/sonner` | `EmptyState`, `ErrorBanner`, snackbar |
| SectionHeader, Divider | | `SectionHeader`, `ui/separator` | `SectionHeader`, `SectionDivider` |

## 3. Phased plan

Order is by user-visible impact first, mechanical clean-up last. Each phase ends with typecheck/lint/tests green
(web: `make front/typecheck front/lint front/test`; Android: `compileDebugKotlin`) and the user checking the screens.

**Phase 0 - Guardrails (small).** Add `success`/`warning` tokens (CSS vars + Tailwind + Android `Color.kt`). Add an
ESLint rule (or a vitest "no raw palette colour / physical class" grep test) that fails on new violations, so the cleanup
cannot regress. Add a `/design` route-free checklist doc (this file).

**Phase 1 - Web primitives.** `pnpm dlx shadcn@latest add textarea switch badge tabs select checkbox separator popover sonner skeleton`;
write `IconButton`, `FormField` (shared required-` *` marker), `ModalShell`, `ListRow`, `EmptyState`, `SettingRow`;
add `Toaster` provider in `app/`. Unit tests for any pure logic. No screen changes yet.

**Phase 2 - Web dialogs (biggest win).** Migrate all 16 `Dialog` users and the 4 `fixed inset-0` overlays to `ModalShell`
(sizes sm/md/lg/media). First the three hard-coded zinc dialogs (`FriendPickerModal`, `ImageEditor`, `UserProfileModal`),
then `NewChannelModal`, `GroupSettingsModal`, `ChannelInfoModal`, `ForwardModal`, `Whisper*Modal`, `ConfirmModal`.
Remove blur/glass and shadows.

**Phase 3 - Web controls and feedback.** Replace hand-built switch, raw inputs/buttons in the settings tabs and chat
input with the primitives; replace 7 `alert()` with toasts (backend message first, i18n fallback).

**Phase 4 - Web colours and RTL (mostly mechanical).** Replace raw palette and hex with tokens (keep black/white video
overlays via a documented `overlay` token); codemod physical classes to logical ones; add `rtl:rotate-180` to directional icons.
Spot-check Arabic.

**Phase 5 - Web structure.** Split the 8 files over ~600 lines into container hook + presentational pieces, moving each
into `domains/<domain>/` as it is touched (chat, voice, settings, friends). Swap `console.*` for `logger` and `any` for
`unknown`/precise types in files touched.

**Phase 6 - Android kit (can run in parallel with phases 2-5; different files).**
1. `Dimens.kt` + `Shapes` + type roles; map the 9 radii to 3 (`sm/md/lg`) and the 155 `fontSize` literals to roles.
2. Build the `Cove*` kit in `ui/components/` (table above); make `PanelDialog` the public `CoveDialog`.
3. Migrate screens one at a time (dialogs first: Whisper, IncomingCall, NewConversation, Search, ChannelDialogs), replacing private rows/buttons.
4. Replace ~50 raw colour literals with theme colours; rename `CoveTheme`/`NT*` to `CoveTheme`/`Cove*` (Kotlin symbols only, package id untouched).

**Phase 7 - Desktop check.** Build the web bundle, confirm Wails window, titlebar and scrollbars with the new theme and ModalShell; fix `isWails()` branches only if something differs.

## 4. Decisions needed

1. Add `success`/`warning`/`overlay` semantic tokens (recommended) vs keep ad-hoc greens/yellows.
2. Dialog sizes `sm / md / lg / media` (recommended) - or different breakpoints.
3. Rename Android Kotlin symbols (`CoveTheme` -> `CoveTheme`) during Phase 6 - recommended; package id stays.
4. Execution: one session per phase for web (they touch the same files, so sequential) and a separate session for the Android kit in parallel.
