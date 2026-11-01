# Phase 1 fix plan

Status: **plan, not started.** Source: code read plus the user's clarifications. Sits under `roadmap-plan.md` Phase 1. Platform tags: W web, A Android, D desktop, B backend.

## Findings and fixes

### 1. Mac traffic-lights vs header height (D, W)
- **Cause.** `MAC_LIGHTS_ZONE` is 40px (`titlebar-layout.ts`) but the sidebar header (`sidebar-header.tsx`) and chat header are 48px, and the native lights are pinned by Wails at their default offset. The lights sit visibly above the header text baseline.
- **Fix.** Try `mac.TitleBar{UseToolbar: true}` in `client-desktop/main.go`, which makes macOS centre the lights in a taller toolbar. Match `MAC_LIGHTS_ZONE` and the header `h-12` to that height so the lights, "Cove Client" row and chat header share one centre line. Keep the numbers in one constant.
- **Verify.** Needs a Mac. I can build and unit-test the layout constants; the user checks the result by eye.

### 2. Sidebar user footer vs bottom bar height (W)
- **Cause.** `sidebar-user-footer.tsx` is `h-[52px]`; the read-only system-chat bar in `ChatArea.tsx:275` is `py-3 text-xs` (about 44px), so the two top borders do not line up.
- **Fix.** Shared constant (e.g. `BOTTOM_BAR_HEIGHT = 52`) used by both. Normal composer is variable height by design, so it stays as is.

### 3. Share link → in-app invite message (W, A, B)
- **Today.** `ChannelInfoModal`, `GroupSettingsModal` and `FriendPickerModal` build `${window.location.origin}/join/<code>` and paste it as plain text; `MessageItem` regex-detects it. Wrong origin on Wails.
- **Target.**
  1. Remove link display and copy fields from channel info and group settings; replace with a **Share** button that opens the friend/conversation picker (`FriendPickerModal` already exists).
  2. Send a new message type `invite` (encrypted JSON body: invite code, channel name, avatar id). Not editable. Rendered as a card with a Join button that reuses `JoinPreview`/`useJoinInvite`.
  3. Backend: add `MessageTypeInvite` in `models.go`, accept it in send validation, block edit on it, and add tests (happy path, edit denied, 401).
  4. Android: render the same card (`InviteCard.kt` exists for the legacy regex) and add the Share action in `ChannelDialogs.kt`.
  5. Keep rendering legacy `/join/<code>` text as a card so old messages still work.
- **Decided:** keep a "Copy invite" button for sharing outside Cove, but never display the URL. The copied link uses the server URL (`BASE_URL` on web and desktop, `serverUrl` on Android), not `window.location.origin`.

### 4. Android audio files treated as documents (A)
- **Cause.** `Attachments.kt:147` passes `asDocument = !asPhoto`, and the audio picker (`ChatScreen.kt:288`) calls `upload(it, false)`, so every picked song gets `as_document = true` and shows as a file card.
- **Fix.** Audio MIME always sends `asDocument = false`. Resolve MIME with a fallback: `getType(uri)`, then file-extension map (mp3, m4a, aac, ogg, opus, wav, flac, amr, wma, mid), then sniff. Picker accepts `audio/*` plus the extension list. Confirm the Android player can play the chosen formats (ExoPlayer/MediaPlayer support; flac/ogg/opus are fine on API 21+).
- **Backend.** Uploads are client-encrypted so the sniff sees opaque bytes; the allowlist in `files.go` only matters for unencrypted paths. Add `audio/aac`, `audio/flac`, `audio/mp4` and `audio/x-m4a` to it for completeness, with a test.
- **Web.** Same check for web: audio attached with the "file" mode is a document. Decide if audio always inlines (recommended).

### 5. Android signing key (A)
- **Today.** `build.gradle.kts` falls back to the debug key when `COVE_KEYSTORE_FILE` is unset, which is why installs are flagged.
- **Plan.** Generate a release keystore once (steps below), store it and its passwords outside git, add the four `COVE_KEYSTORE_*` values as CI secrets, back up the keystore (losing it means users cannot update). Needs the user for the secret and the upload step.

```bash
keytool -genkeypair -v -keystore cove-release.jks -alias cove -keyalg RSA -keysize 4096 -validity 10000
```

### 6. Move "New DM" into the unified search (W, A)
- **Today.** The "+" button opens `NewChannelModal` with DM and channel tabs side by side, which the user finds confusing.
- **Target.** DMs are started from the search dialog (`conversation-search-dialog.tsx`): typing a name lists users (existing filter "dms"/"explore") and picking one opens or creates the DM. "+" only creates channels. Remove the DM tab from `NewChannelModal`. Mirror in the Android search dialog (`ConversationSearchDialog.kt`).
- **Decided:** same scope as today's New DM tab; only the entry point moves.

### 7. Android friend request in the chat top bar (A)
- **Target.** Like web `ChatTopbar.tsx`: in a DM with a non-friend, an add-friend action in the top bar; an incoming request shows Accept / Decline there too. Wire to the existing relationship calls used by `FriendsPage.kt`.

### 8. Android recorder polish (A)
- **Progress bar centring.** `VoicePlayer.kt` (top player, ~line 290-345) uses the Material `Slider` with a 10dp thumb inside a 28dp row, so the track sits off-centre. Replace with a thin custom progress bar (or `Slider` with `Modifier.height` and `Alignment.CenterVertically` plus zero content padding), centred on the row.
- **Recording animation, Telegram-style.** `ChatInputBar.kt` (`RecordingRow`, mic `scale` at line 376): replace the 1.25x scale with a mic button that sits in a growing, amplitude-driven halo (radius follows recent input level), keep the blinking red dot and timer, add slide-to-cancel text that fades as you drag, and a lock affordance sliding up. Animate on the amplitude flow the recorder already produces for the waveform.

### 9. Notification icon (A, D)
- **Cause.** `Notifications.kt`, `ConnectionService.kt`, `CallService.kt` all use `android.R.drawable.*` system icons.
- **Fix.** Add a monochrome Cove glyph vector (`ic_notification.xml`, transparent plus white only, from `branding/cove-mark.svg`), `setSmallIcon` it everywhere, `setColor(terracotta)`, and set the large icon to the sender avatar (or app icon for system notices). Desktop tray/notification glyph already exists; reuse for D.

### 10. More SVG chat patterns (W, A)
- **Today.** Four masks in `src/assets/patterns/` (animals, space, games, sweets), 1440x2960 viewBox, used as a CSS mask in `ChatBackgroundPattern.tsx`, mirrored on Android.
- **Plan.** Add 4 to 6 dense, doodle-style sets matching the existing density (suggestions: travel, nature/botanical, food, music, tech/coding, weather). Draw as single-colour, evenly spread, 25-35px motifs, not hand-written paths from scratch: generate from a license-clean source or compose from simple shapes. Add picker entries and i18n labels in en/fa/ar. Android gets the same SVGs as vector drawables.
- **Decided:** source free, license-clean SVG doodle sets from the internet (check each license, prefer CC0/MIT, record attribution in `branding/` or the pattern folder). Candidates to search: Telegram-style doodle packs on SVG Repo, Hero Patterns, Heropatterns-style CC0 sets, Openclipart. Review them with the user before adding.

### 11. Richer Android user profile (A)
- **Today.** `MemberProfileDialog.kt` shows avatar, name, status, custom message and one "Message" button. It is opened from @mentions and the DM header (`ChatScreen.kt:541`, `:558`). It has no relationship state.
- **Target** (mirrors web `UserProfileModal` + `relation-state.ts`):
  1. Load relationships (`getRelationships`, `getIncomingRequests`) and compute a state: none, friend, requested, incoming, blocked. Put this in one small pure Kotlin function with a unit test, and reuse it for item 7 (chat top bar).
  2. Relationship button by state, via `relationshipAction`: none → Add friend (`request`); requested → Cancel request (`cancel`); incoming → Accept / Decline; friend → Remove friend; blocked → Unblock. Respect `friendRequestPermission` (hide or disable Add when the user does not accept requests).
  3. Action row under the name: **Message**, **Voice call**, **Video call**, **Secret chat** (Whisper). Message resolves the DM as today; call and whisper reuse it. Calls need the DM channel id, so the dialog first creates or opens the DM, then calls `onStartCall(channelId, name, video)` (`NavGraph.kt:195` route `call/{id}/{name}/{video}`). Whisper uses `onStartWhisper(userId, name)` (`NavGraph.kt:162`).
  3b. **Block user** in the profile (a destructive-styled row at the bottom, with a confirm dialog) via `relationshipAction(userId, "block")`; shows **Unblock** (`unblock`) when already blocked. Blocking removes a friendship server-side, so refresh the state after the call.
  4. Hide calls and secret chat for yourself, blocked users and system accounts (the "automated account" DMs).
  5. Optional: bio / member-since if the user summary carries them.
- **Wiring.** `MemberProfileDialog` gains `onStartCall` and `onStartWhisper`; both callers in `ChatScreen.kt` pass them through. `FriendsPage.kt` and a member list tap can reuse the same dialog.
- **i18n.** The Android client uses plain English strings in dialogs today, so match the surrounding code unless the item-wide i18n pass says otherwise.

## Progress

Done (compiled and unit-tested; visuals need the user's eyes on a device):
- 2 footer height: `lib/layout.ts` shared constant.
- 4 Android audio: `AudioMime.kt` (+ test), audio never marked as document, inline `VoiceBubble` for audio files, picker accepts more types. Backend allowlist left alone: uploads are client-encrypted, and Go's sniffer never reports flac/aac anyway.
- 9 notification icon: `ic_notification.xml` used by every notification and both services. Large icon (sender avatar) not done.
- 8 player seek bar replaced with a centred custom `SeekBar`; recorder mic gets a spring and an amplitude-driven halo.
- 11 profile: friend actions, block/unblock with confirm, call, video, secret chat (`RelationState.kt` + test). `friendRequestPermission` is not in the user summary, so a refused request shows the server's error instead of hiding the button.
- 7 friend add/accept in the DM top bar.
- 1 mac: `UseToolbar: true` and `MAC_LIGHTS_ZONE = 48`. Needs a Mac to confirm.
- 6 web: DMs start from the search dialog (people section); "+" is channel-only. Android search dialog not yet changed.

- 3 invite messages: backend `MessageTypeInvite` (+ `Valid()`, unknown types rejected, invites not editable; tests in `backend/tests/invite_message_test.go`, Swagger regenerated). Web: `invite` message renders a `JoinPreview` card, the friend picker sends it, channel info and group settings show Share and Copy invite with no URL. Android: same card, picker sends `invite`, URL no longer displayed. Legacy `/join/` text still renders as a card. The desktop origin bug is gone for Copy invite (uses the server URL).
- 12 Mac red button froze the app: `beforeClose` called the runtime's Hide on the main thread and deadlocked; it now hides from a goroutine. Needs a Mac to confirm.
- 13 Top player bar redesigned on web and Android, Telegram style: round play button, title with time under it, speed / volume / repeat / close, and the progress bar along the whole bottom edge. Recorded notes show "Voice message" instead of the file name.

- 14 Android profile restyled Telegram-style: banner with avatar, round icon quick actions (Message, Call, Video, Secret), icon rows for the friend action and Block.
- 15 Android player bar flat (no boxed border); playlist (`QueueMusic` button, bottom sheet) on Android and web (`ListMusic` popover). Auto-advance to the next audio in the chat; a bubble's title comes from the playlist (sender for voice notes).
- 16 Audio always plays inline on web too (a file attached as a document no longer becomes a card); web gets the same extension-to-MIME fallback as Android.
- 17 Multi-select messages: long-press (Android) or the Select button (web) starts it; a bar replaces the header (Android) or composer (web) with the actions that fit. Delete shows only when every selected message is yours (admins can delete any); copy and forward need text (web also forwards files, voice notes and invites). Android's single-tap action bar is gone.

- 18 Web composer lost typed text and queued files when the layout switched between phone and desktop widths (`AppPage` renders a different tree, so the composer remounted). Text and attachments now live per chat in `composer-drafts.store.ts`. Not covered: the reply-to strip (still ChatArea state) and the Whisper composer, which is deliberately left memory-only.

- 19 Patterns (10): six new sets (travel, nature, food, music, tech, weather) generated from Lucide icons (ISC) by `scripts/gen-chat-patterns.mjs` (`make patterns`): best-candidate packing on a wrapping tile, any rotation, three size classes, seamless repeat. Web SVGs and Android `assets/patterns/*.txt` come from the same layout. Opacity raised on both clients (web 0.025 to 0.06, Android 0.028 to 0.065) and the Android stroke to 4. Notice kept in `client-web/src/assets/patterns/NOTICE.md`. Picker labels are i18n keys (`settings.chat_bg_*`).
- Verified on the Android emulator (Medium_Phone_API_37.0, cold boot after a hang): selection mode, profile card, flat player bar with playlist button, new Music background.

- 20 Solid message cards: web `JoinPreview` (`bg-card`) and both voice bubbles (`bg-secondary`), Android voice bubble and player bar no longer translucent. Pattern strength: web 0.035 behind a chat and 0.09 on the empty page (`variant="plain"`); Android 0.035 to match, and its tile is now rasterised at the screen's real density (cap 3, was 2) so it is no longer blurry.

- 21 Android DMs start from the search dialog (a "Start a conversation" section, `PeopleResults.kt` + test); "+" is channel-only and `NewConversationDialog` lost its DM tab.
- 23 Forwarding voice, audio files, files, video messages and invites (web and Android). Web `ForwardModal` now reuses `encryptAndUploadFile`, treats audio as uncompressed by mime (not only `voice`) and handles `video`; Android gets `Forward.kt` (download, decrypt, re-upload with preview and duration). Copy still needs all-text selections.
- 24 Android profile photos: DM top bar is search only (friend request, call and whisper live on the profile; group channels keep their call button). Settings manages up to 5 photos (`AvatarGallery.kt` rules + tests, mirrors web): add, view, make main, delete. New Telegram-style cropper (`AvatarCrop.kt`: drag and pinch inside a circular window, tick to use; math tested), also used for channel photos. Tapping an avatar on a profile or in settings opens a swipeable full-screen gallery (`AvatarGalleryViewer.kt`); `UserSummary` now carries `avatar_ids`.
- 25 Android: your own profile opens from the avatar/name at the bottom of the list (card with Edit profile, built from `/me`); group channels' top bar is search only like DMs, with Voice call in the group profile. Verified on the emulator: added a photo through the picker and cropper, it became the main photo everywhere, the gallery viewer opens from the profile card and settings. Viewer now scales the photo to the screen width; cropper buttons have more bottom room. Not verified: another user's photo list (needs a second account) and the web profile modal (needs a login).
- 26 Whisper request and call alerts. Web: whisper requests now play their own chime and raise a native browser/desktop notification (tag per session); incoming calls loop a ring (`lib/ringtone.ts`, tested, stops when the call card goes away or after 30 s) and the native notification stays until acted on; strings are i18n (`chat.notify_*`). Android: new `whispers` channel and `calls_v2` channel carrying the bundled sounds (old `calls` channel deleted because a channel's sound cannot change). Sounds are synthesised by `scripts/gen-notification-sounds.py` (`make sounds`). Limit: delivery relies on the app's own connection (the foreground service); there is no FCM/APNs push, so a force-stopped or battery-killed app gets nothing.
- 27 Android Whisper screen is now the normal chat UI under a Whisper theme (`WhisperTheme` in `Theme.kt`, the counterpart of web `.whisper-mode`): same top bar, flat message rows with avatar/name/time and grouping, day separators, welcome-style notice, pattern background and the same composer; only the palette differs. Media cards follow the theme. Whisper message text no longer goes through the UI translator (it is the user's own words) and the input uses the app's Vazirmatn face for Persian/Arabic/Latin. The cause of the reported missing Farsi in the Whisper input was not isolated by reading the code (web and Android inputs match the normal chat); it needs a repro.
- 28 Android release key generated locally in `~/cove-signing` (outside the repo; PKCS12, RSA 4096, 10000 days, alias `cove`, SHA-256 7E:17:BD:19:5F:C5:E5:D9:7A:95:CC:13:5D:91:C3:38:47:39:9C:35:AC:E2:18:56:CC:43:D7:36:D9:A6:0B:A7). A local `assembleRelease` with it produced an APK whose signer matches. Remaining: run `~/cove-signing/set-github-secrets.sh` once `gh` is signed in, and back the folder up offline. Public roadmap: selection mode, chat backgrounds, audio player and notification icon moved to Shipped (plus invite cards, profile photos, audio playlist, forward-all, alerts); `android-trust` stays under Next until the secrets are set.
- 22 Recording no longer shifts the chat: the lock capsule floated above the mic was a 96dp child of its 48dp slot, which grew the whole input row; it now sits in a fixed 48dp holder.
- 5 Signing key: steps given to the user. The workflow reads `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (`release-and-demo-plan.md` says `..._B64`; the workflow is the source of truth). Switching from the debug key means existing installs must be uninstalled once.

### 12. Mac close button freezes the desktop app (D)
- **Cause.** The red button runs `OnBeforeClose` on the main thread; `hideWindow()` called `wruntime.Hide`, which dispatches to the main thread and waits, so it deadlocked.
- **Fix.** `go a.hideWindow()` in `beforeClose` ([window.go](../../client-desktop/window.go)).

### 13. Top audio player bar layout (W, A)
- **Problem.** Time, a short slider, speed, volume, repeat and close shared one row, leaving the slider tiny.
- **Fix.** Two zones like Telegram: controls row (play, title + time, speed, volume, repeat, close) and a full-width progress line along the bottom edge that thickens on hover and shows a thumb while dragging.

## Suggested order

1. 2 (footer height), 8-progress (centring), 4 (audio), 9 (notification icon). Small, isolated.
2. 1 (mac header), 7 then 11 (share the relation-state helper), 6.
3. 10 (patterns).
4. 3 (invite messages, needs backend first).
5. 5 (signing, needs the user).
