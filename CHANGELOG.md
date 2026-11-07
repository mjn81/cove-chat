# Changelog

## [0.11.0](https://github.com/mjn81/cove-chat/compare/v0.10.0...v0.11.0) (2026-11-07)


### ⚠ BREAKING CHANGES

* **clients:** desktop and Android lose their (unused) raw UDP audio path.
* **server:** the legacy UDP packet format (Register/Audio/Join/Leave on server.udp_port) is no longer served. Air-gapped calls use the encrypted media router (docs/udp-media.md); native clients for it are not built yet.
* **files:** serve channel files to active channel members only

### Features

* **android:** admin notices, server update (online and offline) and owner restart button ([d3cfaee](https://github.com/mjn81/cove-chat/commit/d3cfaee3e6fa969ea0fc550e994ab896fe1825d7))
* **android:** encrypted UDP call engine selected per call from server capabilities ([ba4387f](https://github.com/mjn81/cove-chat/commit/ba4387f4c69f2af0974f4d335fb5c4b1fbfea1da))
* **android:** encrypted UDP media protocol layer with Go-vector tests ([3775b50](https://github.com/mjn81/cove-chat/commit/3775b50c4c992b4a844d7c475d6402429b9daea3))
* **android:** explain that calls on raw_udp servers need the UDP client ([b51f7ad](https://github.com/mjn81/cove-chat/commit/b51f7ad61f5af4e0e75a55cdc80c68974aa76120))
* **android:** gate invite sharing on the invite_messages capability ([b062998](https://github.com/mjn81/cove-chat/commit/b0629987cfd31d58b25c01d29cebe07d48868c67))
* **android:** show the sender's profile photo in message notifications ([627b728](https://github.com/mjn81/cove-chat/commit/627b728a5c10deb1b23922c88aafbf27df046662))
* **android:** UDP call building blocks (signals, Opus, jitter buffer, SPS, policies, engine interface) ([5bc8674](https://github.com/mjn81/cove-chat/commit/5bc8674fcc321a065e4f2e8e11d27185a08a00b1))
* **api:** i18n keys for user-facing error messages; docs and invite/WS notes ([3121f78](https://github.com/mjn81/cove-chat/commit/3121f783f3ec82011cd2550e6f4f3010da527832))
* **calls:** encrypted UDP media router for air-gapped mode ([7760dab](https://github.com/mjn81/cove-chat/commit/7760dab6fb06e944076c1c0ea678ddd47ea6e116))
* database repair, notification popups, encrypted UDP calls, Android parity and more ([e3e5469](https://github.com/mjn81/cove-chat/commit/e3e5469184624285195f1213e7e88e0670c3608c))
* **desktop:** animate notification popups ([9437d92](https://github.com/mjn81/cove-chat/commit/9437d9265d27d28c95a1a5fd767ba599add3d622))
* **desktop:** media call core on the shared udpmedia client ([40f0f7d](https://github.com/mjn81/cove-chat/commit/40f0f7d8480686847e1dd2456ea7916b96445f2e))
* **desktop:** replace popup dismiss-all cross with a full-width "Close all" button ([20da515](https://github.com/mjn81/cove-chat/commit/20da515ce4453462e90c8569facc193eb32f6b6d))
* **desktop:** show the sender's avatar and name in notification popups ([8002502](https://github.com/mjn81/cove-chat/commit/8002502b4b3c389b0c2613afb79c8e654e760632))
* **desktop:** stack up to three popups, add dismiss-all, flatten cards ([9f0c384](https://github.com/mjn81/cove-chat/commit/9f0c38471778569edcce3ff4c0de9c4e2ce1313a))
* **desktop:** swipe popups away and tidy their layout ([19b9874](https://github.com/mjn81/cove-chat/commit/19b987458a1da0c74bdc1c4d3b3248c87a247591))
* **desktop:** Telegram-style notification popups on Windows and Linux ([817cdb4](https://github.com/mjn81/cove-chat/commit/817cdb40e67097c007643b9c4a813811e0878e34))
* **desktop:** Wails media bridge with batched frame transport for UDP calls ([3861019](https://github.com/mjn81/cove-chat/commit/3861019248800f477e19b832cb60a65ef58fc6c5))
* **server:** add owner-only POST /api/admin/restart ([002b820](https://github.com/mjn81/cove-chat/commit/002b8202aa283c2d8a43c2ebff44a124f989ffb3))
* **server:** cove-server repair drops a damaged database table and keeps the rest ([5810c59](https://github.com/mjn81/cove-chat/commit/5810c598d29d11d7af8d958717e5f378df94a3e2))
* **server:** repair a damaged database on start-up and tell the admins ([9357849](https://github.com/mjn81/cove-chat/commit/9357849a662523a9209c4e0f28eb31665ab69bfb))
* **web:** add Restart server button to the admin panel ([8af43c4](https://github.com/mjn81/cove-chat/commit/8af43c4e8cc27bb3e08c9c0807d98cd79bbf6277))
* **web:** disable calls on air-gapped servers and point users to native apps ([6c5c655](https://github.com/mjn81/cove-chat/commit/6c5c655b5161e7c5d113dd692e643c5a1abc53a2))
* **web:** enable UDP-mode calls in the desktop app ([2df0397](https://github.com/mjn81/cove-chat/commit/2df0397ee6fb7bab03f8f57febc72ba5ea553c0f))
* **web:** pure helpers for the UDP media path (batch codec, codec detection, playout) ([78e3c42](https://github.com/mjn81/cove-chat/commit/78e3c4232bc905c6585987a9b76b0dad8731eb3c))
* **web:** UdpMediaManager for calls over the encrypted UDP media path ([2b5a849](https://github.com/mjn81/cove-chat/commit/2b5a8499d7fbbece74314f20e9b3050c8112b178))


### Bug Fixes

* **android:** do not block calls on UDP servers now that the UDP engine exists ([b50fa80](https://github.com/mjn81/cove-chat/commit/b50fa803093b0d49d2ea134e2b656bc9e2c0b322))
* **android:** fall back to a plain MediaCodec H.264 encoder when libwebrtc rejects the device's codecs ([8e27c7a](https://github.com/mjn81/cove-chat/commit/8e27c7a227022854ae8ed73b55343ea26c7d4b3e))
* **android:** keep UDP socket I/O off the main thread, route audio on the network thread, isolate engines ([fe4b0e5](https://github.com/mjn81/cove-chat/commit/fe4b0e514c9baae72bb8d29eacb6ea33768cf962))
* **android:** publish a conversation shortcut so notifications show the sender photo when collapsed ([a932a23](https://github.com/mjn81/cove-chat/commit/a932a23b15d15b41e183bb7f1c15a6149b097a88))
* **android:** remove duplicated 'private set' that broke compilation ([eca93c6](https://github.com/mjn81/cove-chat/commit/eca93c61c235b38a078a9b7530185e7cb1952725))
* **android:** remove stray duplicate setter that broke compilation ([5cf23a5](https://github.com/mjn81/cove-chat/commit/5cf23a5010b508c51f2bbfc3579025913fe4f06f))
* **android:** translate remaining English-only UI strings into fa and ar ([5cccb94](https://github.com/mjn81/cove-chat/commit/5cccb94291c1ecd77337f25d64ae61d8be7475ed))
* **backend:** report a zero-filled database table as an error instead of panicking ([fe73fcc](https://github.com/mjn81/cove-chat/commit/fe73fcc2e6d00f54a1ef46dc9889575622757199))
* **calls:** close a Stop/Serve WaitGroup race in the media router ([a7890ab](https://github.com/mjn81/cove-chat/commit/a7890abb6936b50b8bc266e6e49a4cf6a76ba707))
* **desktop:** hidden window no longer suppresses notifications for the open chat ([779fef4](https://github.com/mjn81/cove-chat/commit/779fef42d9b43a02265f904f46749ddce3ab9edd))
* **files:** serve channel files to active channel members only ([8031356](https://github.com/mjn81/cove-chat/commit/803135692a442ecc4b4d72e42f31f5a8c169eb82))
* **rtc:** re-check channel membership on every call signal and evict on kick ([4934f6f](https://github.com/mjn81/cove-chat/commit/4934f6f5b4b6555504a6d9b1151b8aef9e4fe30f))
* **web:** selection highlight fills the whole message row ([886a802](https://github.com/mjn81/cove-chat/commit/886a802d9befdf709720b6a1dad97df815e69382))
* **ws:** validate invite messages against the sender's right to invite ([ba6497d](https://github.com/mjn81/cove-chat/commit/ba6497d5865dfbf6ee202c97e1e65b51bd67d636))


### Code Refactoring

* **clients:** remove dead legacy raw UDP voice clients ([97563d9](https://github.com/mjn81/cove-chat/commit/97563d955bc11034b2c229f0ff6eb0f1b16c50ef))
* **server:** remove the unencrypted audio-only UDP voice router ([e713dfb](https://github.com/mjn81/cove-chat/commit/e713dfb6e8410eafb5091cbe4ed4d97c2faf1db5))

## [0.10.0](https://github.com/mjn81/cove-chat/compare/v0.9.9...v0.10.0) (2026-11-05)


### ⚠ BREAKING CHANGES

* **android:** consume the paged API (api 2) and ask for the password on account deletion
* **web:** consume the paged API (api 2) and confirm account deletion with the password
* **api:** DELETE /api/users/me requires the current password
* **api:** paged list envelope, api_version 2

### Features

* **android:** consume the paged API (api 2) and ask for the password on account deletion ([ed108a8](https://github.com/mjn81/cove-chat/commit/ed108a85fa957b5a820e3444e562a84cf1d7f51a))
* **android:** in-app update check, verified download and system installer hand-off ([41ca663](https://github.com/mjn81/cove-chat/commit/41ca66343865d724b65672ad8ca7c378a878a1df))
* **android:** send X-Cove-Client, handle client_outdated and unknown message types ([d757da7](https://github.com/mjn81/cove-chat/commit/d757da79a8a6139a5ea30703ca90f502c71c0396))
* API standard v2, auto-update, audit hardening ([5939298](https://github.com/mjn81/cove-chat/commit/59392980dd3624b9680af425cb738c5ced77a0ec))
* **api:** add API standard, version negotiation and stable error codes ([d160098](https://github.com/mjn81/cove-chat/commit/d16009845d01c231de402e907ff0cd16657a7558))
* **api:** add owner-triggered server self-update (GET/POST /api/admin/update) ([72b5f77](https://github.com/mjn81/cove-chat/commit/72b5f7701f63d3ede8be01d58d9eaa3bdd21065e))
* **api:** DELETE /api/users/me requires the current password ([fc5579b](https://github.com/mjn81/cove-chat/commit/fc5579b84e50a7a3ed53a62d606cebe234675396))
* **api:** manifest update source, admin update notices and manual upload ([a68793a](https://github.com/mjn81/cove-chat/commit/a68793ad65dc2bb03631f7c914afd6113e18af17))
* **api:** paged list envelope, api_version 2 ([0022512](https://github.com/mjn81/cove-chat/commit/0022512032031dccbaada6f41876f4ac495f9851))
* **desktop:** add background auto-updater with verified staging and rollback ([5f0751b](https://github.com/mjn81/cove-chat/commit/5f0751ba33eed001118d05cec96a8e04346517dd))
* **desktop:** update source setting and opt-in downloads ([1917fe6](https://github.com/mjn81/cove-chat/commit/1917fe68ae7ac4bde8b8d0f8ad336ff9aa08d2ca))
* **site:** publish the release manifest at /releases/manifest.json ([aa61b03](https://github.com/mjn81/cove-chat/commit/aa61b0383cd1626fe6b5877c4abdfddbc8737d40))
* **update:** add shared self-update library (cove/update) ([33077a3](https://github.com/mjn81/cove-chat/commit/33077a3490d5be1c927f10613495846ceefea156))
* **web:** add server update card to the admin overview ([0f38ea6](https://github.com/mjn81/cove-chat/commit/0f38ea618048308bef8dc100021b46e05638392d))
* **web:** consume the paged API (api 2) and confirm account deletion with the password ([7908964](https://github.com/mjn81/cove-chat/commit/7908964825dd7f26bda46f4bb1900f2abb41a9c5))
* **web:** desktop update banner, settings and restart confirmation ([e4e67f9](https://github.com/mjn81/cove-chat/commit/e4e67f96211d147ea84da6277ed1d55e33083141))
* **web:** quiet update icon above the profile card, opt-in downloads and offline upload ([4bec7d8](https://github.com/mjn81/cove-chat/commit/4bec7d80b79d344eead21fd521432b115e29862a))
* **web:** send X-Cove-Client, handle client_outdated and unknown message types ([965988b](https://github.com/mjn81/cove-chat/commit/965988b90d717dcb418d409c8a8ebbd3efca4de9))


### Bug Fixes

* **api:** audit hardening - explore, roles, uploads, step-up, limits, error handling ([38e9df6](https://github.com/mjn81/cove-chat/commit/38e9df6ebb56a0e631e97420770fcedf8fac4063))
* **api:** one JSON error-envelope writer for every layer; 501 maps to feature_unsupported ([c7c3092](https://github.com/mjn81/cove-chat/commit/c7c30929e10e45f727d3e27b50c8bfebb340f6a3))
* **backend:** audit leftovers - rtc join status, voice log, ws headers, login timing ([ea62016](https://github.com/mjn81/cove-chat/commit/ea62016f7c6f8d08cd3cf90d5a9f60ecd36409ff))
* **server:** keep the Windows-only restart helpers in the Windows file so Linux lint passes ([47d9e4b](https://github.com/mjn81/cove-chat/commit/47d9e4bba0011656dfeae7875bfc6066ef2799b9))
* **web:** owner password for server update, restore field order, join public channels by id ([b3d321b](https://github.com/mjn81/cove-chat/commit/b3d321b1d27336bc262478294cbfb86c61e5ef7f))
* **ws:** enforce membership and ownership on read receipts, edits, whispers; rate-limit client events ([3ebb84a](https://github.com/mjn81/cove-chat/commit/3ebb84adc709b85b0e14614b86dab6c2205abab6))

## [0.9.9](https://github.com/mjn81/cove-chat/compare/v0.9.8...v0.9.9) (2026-11-02)


### Bug Fixes

* **desktop:** Cmd+Q quits for real on macOS and the nav rail icons sit closer to the traffic lights ([ec4357d](https://github.com/mjn81/cove-chat/commit/ec4357dbaf12d2c6d26dede7463bc7ef97e03d78))
* **desktop:** Cmd+Q quits on macOS, nav rail icons closer to the traffic lights ([6e3493e](https://github.com/mjn81/cove-chat/commit/6e3493ee110929bb2ca6867cccc872c0140c0a9b))

## [0.9.8](https://github.com/mjn81/cove-chat/compare/v0.9.7...v0.9.8) (2026-11-01)


### Features

* **android:** invites, multi-select, playlist, profile photos with cropper, Whisper on the chat UI, alerts, patterns ([22acaf2](https://github.com/mjn81/cove-chat/commit/22acaf23e6b50ed86b357ddb1f6d2108cb01ccd1))
* **backend:** invite message type, reject unknown message types, block editing invites ([6092eb3](https://github.com/mjn81/cove-chat/commit/6092eb3406beacdfb65e0a668b89f8048bf37383))
* invites, multi-select, playlist, profile photos, Whisper UI, alerts and patterns ([a175695](https://github.com/mjn81/cove-chat/commit/a1756950170438987c7543102de58bd339d22208))
* **web:** invite cards, multi-select, playlist, forward all types, whisper and call alerts, new chat patterns ([68d3ff0](https://github.com/mjn81/cove-chat/commit/68d3ff0458ee722df1cd1e00c1ab3de75ab26bd4))


### Bug Fixes

* **desktop:** hide from a goroutine on macOS close and use the toolbar title bar ([efa9656](https://github.com/mjn81/cove-chat/commit/efa9656d6c32c16674ad81fafb9fd08da7d32769))

## [0.9.7](https://github.com/mjn81/cove-chat/compare/v0.9.6...v0.9.7) (2026-10-30)


### Features

* **desktop:** themed tray menu with preference toggles, working tray clicks, forced quit ([a6fdf2e](https://github.com/mjn81/cove-chat/commit/a6fdf2e0798a2eaf3388b02b02bcdb3442fa0c20))


### Bug Fixes

* **web:** keep the demo banner below the desktop title bar and off signed-in screens ([d0484b9](https://github.com/mjn81/cove-chat/commit/d0484b9d09927631f9a737f0c4dbeb7cbca7b4a3))

## [0.9.6](https://github.com/mjn81/cove-chat/compare/v0.9.5...v0.9.6) (2026-10-30)


### Features

* **desktop:** glyph taskbar and tray icon that follows the Windows light/dark theme ([62b1679](https://github.com/mjn81/cove-chat/commit/62b1679bfa1e47d7580cb07fe198cae9074fa434))
* **desktop:** Telegram-style macOS window chrome, traffic lights inside the nav column ([bb4e305](https://github.com/mjn81/cove-chat/commit/bb4e305d93b26af220244218bf310a2760868f5a))


### Bug Fixes

* **backend:** allow the real macOS and Linux desktop origin (wails://wails) ([990daa8](https://github.com/mjn81/cove-chat/commit/990daa8ec3407fd9896fc797ebb3745646a58b1e))

## [0.9.5](https://github.com/mjn81/cove-chat/compare/v0.9.4...v0.9.5) (2026-10-30)


### Features

* **android:** passcode lock, devices page, invite cards, voice and video trimming, in-app video message recorder ([93e2fb9](https://github.com/mjn81/cove-chat/commit/93e2fb98c8e2ca92ad59291570bf8d4ad993e207))
* **backend:** active devices, login notices from a Cove system account, invite previews, offline GeoIP ([b50a92a](https://github.com/mjn81/cove-chat/commit/b50a92a87a6a6b78534395304b9f0fc039292f3e))
* **desktop:** OS keystore for the session, passcode lock, tray and autostart, safer downloads ([b1673a6](https://github.com/mjn81/cove-chat/commit/b1673a6517b1c66f6ec2754765c9a4708ab74add))
* **web:** devices list, owner notices, invite join cards, encrypted local cache and desktop passcode UI ([07a9fca](https://github.com/mjn81/cove-chat/commit/07a9fcad9abdfd88b32637adc634bb888d6c7825))
* **website:** refined navigation and responsive layout; regenerate API and config references ([60bcee5](https://github.com/mjn81/cove-chat/commit/60bcee51c779dd7eb4389b82a99007686701dd4c))


### Bug Fixes

* **desktop:** title bar stays above overlays and full-screen layers start below it ([4ab8394](https://github.com/mjn81/cove-chat/commit/4ab8394e13d15ff0cedaefe9bede461a76f124f0))
* **website:** download rows use one font size, tag stays beside the label, iOS no longer detected as macOS ([07ecf67](https://github.com/mjn81/cove-chat/commit/07ecf672992a6396f526742ee6955e311f8118a8))

## [0.9.4](https://github.com/mjn81/cove-chat/compare/v0.9.3...v0.9.4) (2026-10-28)


### Bug Fixes

* **auth:** don't throttle the sign-up challenge with the sign-in limiter ([e6d035e](https://github.com/mjn81/cove-chat/commit/e6d035ec16310aa47f49886070e7e17f3f6aca7a))

## [0.9.3](https://github.com/mjn81/cove-chat/compare/v0.9.2...v0.9.3) (2026-10-28)


### Features

* **auth:** replace Turnstile with a self-hosted ALTCHA sign-up check for every server ([6d93d88](https://github.com/mjn81/cove-chat/commit/6d93d88e4bb77de829cf641d22231d809068dbd1))


### Bug Fixes

* **dev:** make wails/dev rebuild the web client; add register page sign-up check tests ([9ef0c71](https://github.com/mjn81/cove-chat/commit/9ef0c71a4b1d935977ac14f75c673c3e9e92996e))
* **ws:** wait for connection work before the database closes ([73f4e15](https://github.com/mjn81/cove-chat/commit/73f4e15a58d11c263628e39841054ff947dfa936))

## [0.9.2](https://github.com/mjn81/cove-chat/compare/v0.9.1...v0.9.2) (2026-10-28)


### Features

* **clients:** https-first server addresses, public demo shortcut, connect docs ([b77ca22](https://github.com/mjn81/cove-chat/commit/b77ca225e791afb20f6f4f3d80f25961079ce10f))
* **demo:** Turnstile sign-up bot check and a dismissible demo banner ([d8f3853](https://github.com/mjn81/cove-chat/commit/d8f3853e7630b934db3887ef70813d6475415400))


### Bug Fixes

* **ci:** publish only our own artifacts, skip docker build records ([3434224](https://github.com/mjn81/cove-chat/commit/3434224b13aba840961d4d4b6ff59363bd995ae3))
* **clients:** save the https origin when http is redirected to https ([5150dbd](https://github.com/mjn81/cove-chat/commit/5150dbd2b1379cd26ad04f3204e8a2e64eb2c8e3))
* **website:** restore nav blur, per-arch download links, rebuild site after each release ([898075c](https://github.com/mjn81/cove-chat/commit/898075c1aa8be48270928f3bd475bdb5a8e33b1e))
* **ws:** allow the Wails desktop origins on the WebSocket ([af48b7f](https://github.com/mjn81/cove-chat/commit/af48b7f05f0aa9fdeb0d0bea07c44bd0b4b291ca))

## [0.9.1](https://github.com/mjn81/cove-chat/compare/v0.9.0...v0.9.1) (2026-10-28)


### Features

* add audio waveform generation and specialized file bubbles for media and voice messages ([b5cc54d](https://github.com/mjn81/cove-chat/commit/b5cc54dfd19edbbc526a41cbd6dcde6490563440))
* add channel settings UI, update active channel state on fetch, and broadcast channel updates to members ([8f8b492](https://github.com/mjn81/cove-chat/commit/8f8b49221ed839209bc6eaf76d9c93fb2c5a5778))
* add collapsible state and layout adaptivity to RightSidebar component ([bb3863e](https://github.com/mjn81/cove-chat/commit/bb3863eab76940e87bfe661aaa7b947aa2c3d2ff))
* add configurable CORS origins and file size limits to backend middleware ([8bbe125](https://github.com/mjn81/cove-chat/commit/8bbe125b1d04ef93701efed784b71b1fbfed6a66))
* add context menu component and expose member roles in channel API responses ([391259e](https://github.com/mjn81/cove-chat/commit/391259e94791544c015d99946b0ea9b0e56f4fda))
* add discard functionality to VoiceRecorder to prevent saving unwanted audio recordings ([8603f83](https://github.com/mjn81/cove-chat/commit/8603f83227a4db310a0912ddb2bd721ffc80a4d4))
* add Docker support, implement system stress test, and update project documentation. ([63b8e5c](https://github.com/mjn81/cove-chat/commit/63b8e5cbd94709117817bc9d3ebc0b62a5457139))
* add embedded WebRTC SFU and STUN/TURN server with frontend UI components ([53710b4](https://github.com/mjn81/cove-chat/commit/53710b4be830a7756c794ea1255d8606f7915c06))
* add file decryption progress bars to FileBubble and update API client to support progress tracking ([8599aaa](https://github.com/mjn81/cove-chat/commit/8599aaa2f403310e980bca657b413b9fe1ed49a0))
* add full-screen image/video preview and file name support to FileBubble component ([11bbf40](https://github.com/mjn81/cove-chat/commit/11bbf4041bd4342136eca51a46b499cf86168a57))
* add leave channel functionality with real-time broadcasting and optimize unread message counts using KSUID indexing ([9d5bfae](https://github.com/mjn81/cove-chat/commit/9d5bfaea73fa5437607d03d6e49d28abac13924d))
* add message search functionality to ChatTopbar and ChatArea ([9953f19](https://github.com/mjn81/cove-chat/commit/9953f19473141ff5700ca4bcd5bfef5214b8809b))
* add performance profiling, optimize sidebar rendering with memoization, and update backend models to support message replies. ([d11b977](https://github.com/mjn81/cove-chat/commit/d11b9771c8453d5c48144ea8467f53a32a482d0a))
* add personalized DM headers to message feed and clean up sidebar layout ([2cb6b1b](https://github.com/mjn81/cove-chat/commit/2cb6b1b8cdafbfa67e8f0808978be64cfe8590a8))
* add private channel support, implement membership authorization middleware, and update channel exploration API ([553b278](https://github.com/mjn81/cove-chat/commit/553b278f47e845ebcdf70bcd0e99c0a9d2d93fd5))
* add production docker-compose example and update base images and dependency installation ([904607d](https://github.com/mjn81/cove-chat/commit/904607dfd7be34e94792029aced7e49e192315e6))
* add release packaging script and documentation while removing project blueprint files ([9dcca60](https://github.com/mjn81/cove-chat/commit/9dcca60b8c5fad27d83ce58540e89bae0468d50b))
* add shared WebSocket manager, structured logger, and frontend error boundary ([699733a](https://github.com/mjn81/cove-chat/commit/699733a135d03aebfbe756131735a20833cae632))
* add support for interactive join invitations via URL parsing and chat previews ([c74d3af](https://github.com/mjn81/cove-chat/commit/c74d3afd28bdc4673a87ad7ed4a3f4e84a6b0dd4))
* add support for user avatars and implement light mode theme variables ([a400052](https://github.com/mjn81/cove-chat/commit/a400052e98df13a0ec43e786258e71820d7494e1))
* add swipe-to-reply functionality and mobile action menu to MessageItem ([7434349](https://github.com/mjn81/cove-chat/commit/743434953547d00182d4de5b71b31a16696925af))
* add tasks for modal gestures, light mode day tags, and Farsi i18n to TODO list ([7fb5251](https://github.com/mjn81/cove-chat/commit/7fb52512285e21ef14e858ee317c218dcd2e0949))
* add user volume and mute state management to voice store and UI components ([9b703be](https://github.com/mjn81/cove-chat/commit/9b703be9dfeaa485d15a2c8d4b2da11687781370))
* add Vazirmatn variable font support to tailwind configuration and global styles ([1caaa9d](https://github.com/mjn81/cove-chat/commit/1caaa9d449add001fdb94a0b67fe578462cc2b5b))
* add video messaging, client-side image compression, and new settings and chat features ([fea5642](https://github.com/mjn81/cove-chat/commit/fea56427b5f562f12de4a9488b9c8bb9561e3caf))
* add voice and microphone configuration tab to settings with input testing functionality ([7425787](https://github.com/mjn81/cove-chat/commit/74257878ee438965040642537de3821422d21b8b))
* add Wails environment detection, ServerSelection page, and platform configuration updates ([71552e5](https://github.com/mjn81/cove-chat/commit/71552e5cf8cd2f6ed569f3b004fb5e1d5ae8a3a4))
* add WebRTC keyframe request handling and improve remote media track routing ([c4d427e](https://github.com/mjn81/cove-chat/commit/c4d427e7808cee664ea5f78d44f79d51c9db38cd))
* add welcome header to top of chat feed and update loader visibility logic ([55afae1](https://github.com/mjn81/cove-chat/commit/55afae1ca2b4767a6f12c5fd0c134fbcb8ea825c))
* **admin:** restore a backup from the panel (replaces all data, signs everyone out) ([b9c7f78](https://github.com/mjn81/cove-chat/commit/b9c7f78f1deaf9588426db96180c5e80d01ab5c6))
* **admin:** restore subcommand, disconnect sockets on reset, README docs ([1358eb8](https://github.com/mjn81/cove-chat/commit/1358eb8aa35aefbfe8e4efc2d7d012be98a1b61c))
* **android:** add API client, WebSocket manager, models and crypto ([3da7afc](https://github.com/mjn81/cove-chat/commit/3da7afc9df4c3963b9cd48256cbc67167f776be0))
* **android:** add conversation list, chat and attachments ([74529c7](https://github.com/mjn81/cove-chat/commit/74529c711aec0d04e52227d0793f8326dfe7cc91))
* **android:** add Gradle project, manifest and resources ([488cb13](https://github.com/mjn81/cove-chat/commit/488cb1385929a1bdd2c7ebce420e9ba2b53c1bd4))
* **android:** add local message notifications ([ebc14e0](https://github.com/mjn81/cove-chat/commit/ebc14e06be154ec978958777ac1b8dcd8beb9195))
* **android:** add Persian and Arabic translations with RTL layout ([46f34f4](https://github.com/mjn81/cove-chat/commit/46f34f4655d89a848d6d3355cda71c4569f314da))
* **android:** add profile editing, avatars and remaining settings pages ([02b6645](https://github.com/mjn81/cove-chat/commit/02b664576a0e9ab9c8e0fe854d19ffe7572343c1))
* **android:** add server select, login and register screens ([15a5383](https://github.com/mjn81/cove-chat/commit/15a538316e2184436a2187fcc04883d8e8cc0e5a))
* **android:** add settings, friends and call screens ([af2c8f9](https://github.com/mjn81/cove-chat/commit/af2c8f96bb8be4bed7de1336bd4892e49f532f65))
* **android:** add theme, shared components and navigation ([ddeb37b](https://github.com/mjn81/cove-chat/commit/ddeb37b60715db3c315b462bae13ed9e6106179c))
* **android:** add voice and video messages ([db044fb](https://github.com/mjn81/cove-chat/commit/db044fb6de25cbf31d58d471f0848f79730a078c))
* **android:** add WebRTC and raw UDP calling engines ([1cac082](https://github.com/mjn81/cove-chat/commit/1cac0824e51a12eff90a7e1352b00e64a5dea2ec))
* **android:** add Whisper zero-persistence E2EE chats ([3cfc882](https://github.com/mjn81/cove-chat/commit/3cfc882444a80ddaad67cff6768c89217f6eff9e))
* **android:** Cove component kit, terracotta theme and renames ([02e2477](https://github.com/mjn81/cove-chat/commit/02e2477b65ba1c48614a19db8dd5209d6fef5fa7))
* **android:** in-place video playback with fullscreen and web-style voice player bar ([c559cba](https://github.com/mjn81/cove-chat/commit/c559cba430702f335644f88a50ceb4fdc66bd12d))
* **android:** long-press copy, mention profiles and [@mention](https://github.com/mention) suggestions ([1a214ae](https://github.com/mjn81/cove-chat/commit/1a214ae5e4191df76e573e760c4253397a77a274))
* **android:** mask invite codes and add expiry time ([ba76d68](https://github.com/mjn81/cove-chat/commit/ba76d68a83895e81429698412fc538fe3dc4ae27))
* **android:** match web conversation search/explore and message composer ([ab5bce1](https://github.com/mjn81/cove-chat/commit/ab5bce169fb92b57df7b044617146a8ed71a38ef))
* **android:** match web voice/video bubbles and date separator ([02b1d95](https://github.com/mjn81/cove-chat/commit/02b1d95d521dcc40286cadf78a47bf81525a5a44))
* **android:** mobile composer, chat backgrounds, full calls, Whisper, swipe reply/forward, new icon ([b2b4bfe](https://github.com/mjn81/cove-chat/commit/b2b4bfe7dfffbf1e9f8f5431467475ad83db79dd))
* **android:** native notification system with calls, inline reply and background connection ([6854ed8](https://github.com/mjn81/cove-chat/commit/6854ed8052ad49f1dd6305de214cec45aef52408))
* **android:** report unread count for launcher icon badges ([e471b29](https://github.com/mjn81/cove-chat/commit/e471b290d02325dabd179c0bedc2324547ea123c))
* **android:** restore backup from admin panel ([a65f841](https://github.com/mjn81/cove-chat/commit/a65f841fc3cf2295f332485dc9d6aae3677d88f2))
* **android:** rewrite group calls for the NodeTalk SFU protocol ([8c687fc](https://github.com/mjn81/cove-chat/commit/8c687fce82ef52f9cfa2edcb17624ae2960df933))
* **android:** server admin panel and invite-aware register screen ([2602198](https://github.com/mjn81/cove-chat/commit/2602198061eb987bf0ac1f4362654340cdda4aa5))
* **android:** show web-sent video files as playable video tiles ([9153d81](https://github.com/mjn81/cove-chat/commit/9153d817d1a8d973d230fc0bc4d71438ef33c650))
* **android:** tappable links, emails and mentions in messages ([1b23365](https://github.com/mjn81/cove-chat/commit/1b233658e7dd3380fce3a70b259e6d4120d70d46))
* **backend:** opt-in demo mode with user cap, per-IP signup limit and demo flag ([7dac285](https://github.com/mjn81/cove-chat/commit/7dac285c5f1fc2373217cabab56918cebe4e3825))
* **backend:** single-source version via root VERSION and ldflags ([048e249](https://github.com/mjn81/cove-chat/commit/048e2490288235b0b4518d5024e2cda3633987cf))
* **brand:** rename NodeTalk to Cove ([63c28a0](https://github.com/mjn81/cove-chat/commit/63c28a05aaebffacb6ad07eeea6d30bf9deac07b))
* broadcast encrypted channel keys to members via WebSocket upon channel creation ([4ba7162](https://github.com/mjn81/cove-chat/commit/4ba71622e97cef22f84f9c9475bb4bd9aec0822f))
* **calls:** call layout, controls and incoming-call refinements on web and Android ([e7ff645](https://github.com/mjn81/cove-chat/commit/e7ff645450b2a7c22ff0120907a24f24d71f1768))
* **docker:** ship ffmpeg in the server image and document it ([a4bef19](https://github.com/mjn81/cove-chat/commit/a4bef190ac0ee13263962931b352614345d3f79b))
* implement channel management with support for updating channel settings and deleting groups ([502180f](https://github.com/mjn81/cove-chat/commit/502180fea422423fbc3fcc36359b8d1b1c8b9b41))
* implement channel member role management with UI controls and refactor websocket logic into handlers ([ad2c138](https://github.com/mjn81/cove-chat/commit/ad2c138b386b37a026ba14ec65f3e3e7f5e554e7))
* implement custom AudioContext-based voice player with playback controls and seeking ([b09ff0a](https://github.com/mjn81/cove-chat/commit/b09ff0abff2dc7f44bf9b1407626d85bceb468d4))
* implement custom hooks for users, channels, and messages, enhance error translation, and refactor chat input logic ([8d00456](https://github.com/mjn81/cove-chat/commit/8d00456c05fac404d05eed1e2414d71b2681e059))
* implement DM de-duplication, add member names to channel responses, and update UI to display resolved display names ([6f24750](https://github.com/mjn81/cove-chat/commit/6f24750ec591c13dc388879b0df582f54cc8d71e))
* implement interactive speed control slider for the voice player ([bd9c1f0](https://github.com/mjn81/cove-chat/commit/bd9c1f018d03ed215d489ec5e5b0fcd05992e3fe))
* implement message editing and deletion with persistence, updated cursor-based pagination, and a reusable confirmation modal. ([90507b5](https://github.com/mjn81/cove-chat/commit/90507b5cd4b177f724c9c54feac05d36951b4ee1))
* implement mobile-responsive layout with sidebar navigation and navigation drawer ([c1ce395](https://github.com/mjn81/cove-chat/commit/c1ce395fc205108ecca206e5ad3cbc57b7e7f5e8))
* implement native cross-platform desktop notifications using beeep library ([cb11771](https://github.com/mjn81/cove-chat/commit/cb11771537549b7f54c7c007a450d1faaa7df39a))
* implement native macOS microphone permission requests and configuration for Wails app ([d7320f1](https://github.com/mjn81/cove-chat/commit/d7320f11247c4a42b4b113c6dd0682f463e43992))
* implement persistent message caching using IndexedDB with Dexie ([3e43bb8](https://github.com/mjn81/cove-chat/commit/3e43bb809222e5998a759636773320dcaa58f05b))
* implement public channel discovery and join functionality with user ID-based member management ([ff46a66](https://github.com/mjn81/cove-chat/commit/ff46a6683f8ceac975daebbf57ddfa7ea64684b7))
* implement realtime user presence tracking and update status display in UI ([5ce44c3](https://github.com/mjn81/cove-chat/commit/5ce44c3e7e01e9ae1291d5b265ae327f22232755))
* implement SaveFile functionality across frontend and backend ([116ad7e](https://github.com/mjn81/cove-chat/commit/116ad7e3b934701378c7a9b6a98d66e133b43ee0))
* implement secure file upload with ZSTD compression, AES-GCM encryption, and thumbnail generation, and add UI components for chat message rendering. ([b04abad](https://github.com/mjn81/cove-chat/commit/b04abad37237b3eb55549748803048b90847cda5))
* implement SendChannelKey and invoke it upon channel membership joining ([1f79823](https://github.com/mjn81/cove-chat/commit/1f79823e3848141966fa14f1c349da197b6255ef))
* implement system-wide notification sounds and browser desktop notifications for new messages and group joins ([446f0fc](https://github.com/mjn81/cove-chat/commit/446f0fc2243c0cdeb2da4ff523e71cd11fe17fd1))
* implement user presence status updates and real-time broadcasting ([19f8448](https://github.com/mjn81/cove-chat/commit/19f8448736b706f1f4d516f52cc0c11d18fe6ed6))
* implement virtualized message list with infinite scrolling and optimized grouping logic ([1770486](https://github.com/mjn81/cove-chat/commit/1770486f080c0e7b252c72919e07e9707506cc95))
* implement voice chat system with Wails-based UDP streaming and UI controllers ([2926201](https://github.com/mjn81/cove-chat/commit/2926201409717820fe4306abd8a88c56dc3a6d98))
* implement WebSocket connection fallback to direct sockets when SharedWorker is unavailable and support token authentication via query parameter ([a0ea9ab](https://github.com/mjn81/cove-chat/commit/a0ea9ab6ad47254bb1ce5532cc86a6a0096c594c))
* implement Whisper zero-persistence E2EE messaging and update video recorder modal layout ([8d684ab](https://github.com/mjn81/cove-chat/commit/8d684ab7ac5e2056ddec0d47ba95b9281e050a15))
* improve user authentication, session management, and chat mention functionality ([84cd875](https://github.com/mjn81/cove-chat/commit/84cd8756c33388f99f8cf81b7b86c84ae85c6567))
* include additional user profile fields in login response and update UI components for avatar and channel rendering ([e3d66c9](https://github.com/mjn81/cove-chat/commit/e3d66c90fcec37deced3d25c63a96a1b9930f463))
* initial NodeTalk implementation — Phases 0–4 ([df1b195](https://github.com/mjn81/cove-chat/commit/df1b1954b36425ecc14fb90f07fbbed162209b62))
* introduce status preference system and update UI to display granular user presence states ([174c8e7](https://github.com/mjn81/cove-chat/commit/174c8e7f63b3f3652d650abb44aed66191825ce9))
* migrate notification settings to global store and improve UI layout in settings tabs ([3efc662](https://github.com/mjn81/cove-chat/commit/3efc6624e37fe6313cc8d4c3954f0f91e8719eaf))
* migrate thumbnail generation to WebP format and enhance FileBubble UI animations ([5d77cb4](https://github.com/mjn81/cove-chat/commit/5d77cb45e51f8b0b5a51cd0f74da2ea0fb174693))
* restructure the entire project + adding complete light mode ([f9a20af](https://github.com/mjn81/cove-chat/commit/f9a20af9a31d5f32dcd3d5bbbe980ebd5ffb2ca1))
* return full channel response when joining or already a member of a channel ([5c25dd9](https://github.com/mjn81/cove-chat/commit/5c25dd97af6939d8ab834c4a3d68a2f9cda0881d))
* server admin panel with registration modes, invites and owner tools ([e5ab79e](https://github.com/mjn81/cove-chat/commit/e5ab79ed2add486898e938f924a018c56be702c0))
* update application and favicon assets with optimized raster image data ([8c090af](https://github.com/mjn81/cove-chat/commit/8c090af0265daa5712219e8569d44e14477c07c0))
* update build assets, add Vazirmatn font, and refresh desktop app bundle ([3df8e64](https://github.com/mjn81/cove-chat/commit/3df8e64cf99c2680263f9ffe04472e1d197b3fad))
* updating frontend left sidebar and its related apis ([1e7bc56](https://github.com/mjn81/cove-chat/commit/1e7bc56a995d455494b4d68c0221bb1f0a4b773a))
* **web:** long-press copy, clickable mention profiles, working mention suggestions; clean lint ([07e2632](https://github.com/mjn81/cove-chat/commit/07e2632ccf0cf0a711a00c1c670e242cc4b81106))
* **web:** make URLs and emails in messages clickable ([f0a4251](https://github.com/mjn81/cove-chat/commit/f0a42517980ad6baecdbbffcf09de5ba5a6b679e))
* **web:** mask invite codes, pointer cursor on menu items, reusable date-time picker ([38e4b04](https://github.com/mjn81/cove-chat/commit/38e4b045cc47792f13abeeb98b696817f3e487dc))
* **web:** mobile-friendly composer and topbar with a single record/send action button ([629f948](https://github.com/mjn81/cove-chat/commit/629f948a09989e81302f4270d87ff64246f63dd5))
* **web:** shared design system ([27245ac](https://github.com/mjn81/cove-chat/commit/27245acb07c68e756310673cda01617d4bbb7d08))
* **website:** accurate app mockup, star banner, faster theme ripple, number fixes ([3777cda](https://github.com/mjn81/cove-chat/commit/3777cda31fe0be140ac2601db1a564b87a522bb2))
* **website:** add landing site, docs and roadmap (EN/FA/AR) ([3ea4598](https://github.com/mjn81/cove-chat/commit/3ea4598a732d1bbc397e4bf1723b711e18e20c32))
* **website:** composer demo with mode dots, fix stat number sizing and layout ([a0e0533](https://github.com/mjn81/cove-chat/commit/a0e05338526f8f1ba56a99842ff4bc07ac2b5b1b))
* **website:** mark builds as Beta, read pre-releases from GitHub; update release plan ([2c8b436](https://github.com/mjn81/cove-chat/commit/2c8b4362b4c2a8c80c2de2be988ab4c27cf17d8b))
* **website:** per-card hover colors and subtle textures on the feature cards ([689b9a4](https://github.com/mjn81/cove-chat/commit/689b9a4402c491afa1766b1fc0b1165eb9fcecf5))
* **website:** SEO, covechat.dev, docs layout, rename fallout ([eb44553](https://github.com/mjn81/cove-chat/commit/eb44553b2165014e90f09c6c7ba917be5e07b155))
* **web:** terracotta theme and semantic tokens ([cdf5649](https://github.com/mjn81/cove-chat/commit/cdf564917f1d44c25a86584682f2673184147f5c))


### Bug Fixes

* **android:** fall back to sent duration for voice files without a duration header ([a8cec76](https://github.com/mjn81/cove-chat/commit/a8cec76864d6744143498bcb9f2c30527125ae65))
* **android:** load zstd-jni from its Android AAR so attachments decode ([2a71f1a](https://github.com/mjn81/cove-chat/commit/2a71f1a5b9ad1b026cb01637de1c003d3b5fbc1f))
* conditionally render context menu separator in RightSidebar based on promotion permissions ([e893488](https://github.com/mjn81/cove-chat/commit/e89348835c29562022dee9676b6a4beeaeab7877))
* constrain max width of reply preview text in MessageItem to prevent layout overflow ([ef6713a](https://github.com/mjn81/cove-chat/commit/ef6713a1e4825e21b8f1cc9d7b49c05bac4ce9c4))
* only display tooltip content in right sidebar when collapsed ([7a11794](https://github.com/mjn81/cove-chat/commit/7a11794a70432ecdd9c9306e90810694cde74f64))
* prevent duplicate channels in store during creation ([dd981f7](https://github.com/mjn81/cove-chat/commit/dd981f7cc2138fba855876a7ba98571c2dd64dc3))
* prevent websocket message reordering and shared worker memory leaks with comprehensive unit tests ([240beca](https://github.com/mjn81/cove-chat/commit/240beca4e978fb3a5d60876945edeefd81cd76de))
* resolve race condition in server initialization by reordering dependency startup ([44766d9](https://github.com/mjn81/cove-chat/commit/44766d9016dca51ad07ec78e6baa565ff0eb5a69))
* **rtc:** return an empty ICE server list and replace a stale session on rejoin ([f75004f](https://github.com/mjn81/cove-chat/commit/f75004f979f5e3981b04928dd766075c06445ba6))
* **web:** banner default, right sidebar leave button, whisper placeholder, icons ([80704c2](https://github.com/mjn81/cove-chat/commit/80704c24f122457b8bb580450e49b1e4d6ae2324))
* **web:** date picker clicks were swallowed inside dialogs; default minute shown ([f9e59dd](https://github.com/mjn81/cove-chat/commit/f9e59dd828a41da866e217a2bdb6fb3f11f3d4cb))
* **web:** harden the call manager (join timeout, mic retry, serialised publish offers) ([f816671](https://github.com/mjn81/cove-chat/commit/f8166718715b06f1f0a0af84273bebb58cc901bd))
* **website:** drop the loading-state [encrypted] preview from the app mockup ([2bb3ca7](https://github.com/mjn81/cove-chat/commit/2bb3ca71b7045b4fbeecdad49e098ebda9db6de9))
* **website:** keep 'Your keys.' on one line and stop the gradient clipping descenders ([a1e1c8c](https://github.com/mjn81/cove-chat/commit/a1e1c8c579330b5efd4964de15047084c85d0b91))
* **website:** keep card textures clear of the card border ([bf0aa0b](https://github.com/mjn81/cove-chat/commit/bf0aa0b77ffc51db53e6872745952baead0e450b))
* **website:** remove icon hover zoom and star banner wobble ([60341ca](https://github.com/mjn81/cove-chat/commit/60341ca8d6345564c154df10aa4b1366c210aec8))
* **website:** tech marquee in RTL pages ([de89ff7](https://github.com/mjn81/cove-chat/commit/de89ff7b2edb8d269ae7551e8f8ee168a5b1ee6a))
* **website:** treat empty SITE_URL/SITE_BASE as unset ([c583029](https://github.com/mjn81/cove-chat/commit/c583029181a071f199bee560f6203476a8a75795))
* **website:** unique feature card textures; hover color now actually per card ([27cbb3f](https://github.com/mjn81/cove-chat/commit/27cbb3ff1882d4d5dabb395c8f46062065f598d3))
