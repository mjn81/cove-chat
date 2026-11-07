# Encrypted UDP media (air-gapped call mode)

Status: **v1, backend + Go client library implemented; desktop client code written and unit tested, not yet verified with real devices** (see
[Implementation status](#implementation-status)).

This document specifies the call media path used when the server runs with `voice.mode = "raw_udp"`
(air-gapped or isolated LANs with no ICE, STUN or TURN). It is the only UDP call path and uses the UDP port
(default `9090`); the older unencrypted, audio-only router was removed (migration note: its packets are no longer
answered, and there is no opt-in to bring it back). The user-visible behaviour matches `voice.mode = "webrtc"`: members-only
rooms, audio, camera video, screen share, mute/camera/share state, join/leave and kick handling. Only the
transport differs, and only native clients can speak it, because a browser cannot open raw UDP sockets.

Code: protocol and client in [`backend/pkg/udpmedia`](../backend/pkg/udpmedia) (module `cove/udpmedia`, standard
library only, shared with the desktop shell), server in [`backend/internal/mediarouter`](../backend/internal/mediarouter),
tests in `backend/tests/udpmedia_*_test.go`.

## 1. Design summary

* **Control plane = the existing authenticated WebSocket.** Joining, leaving, roster, track state (mute, camera,
  share), keyframe requests and kicks reuse the `call_*` events of the WebRTC mode, so permission rules are the same
  code path: the user id comes from the session, never from a payload, and a join needs an *active* channel
  membership.
* **Data plane = one UDP socket, hop-by-hop AEAD.** Every participant has a private session with the server
  (AES-256-GCM, one key per direction). The server authenticates and decrypts each packet, then re-encrypts it
  separately for every other participant in the room. This is the same trust model as the WebRTC SFU (DTLS-SRTP is
  also hop-by-hop) and the "server-trusted" model of the rest of Cove. It is **not** end-to-end encrypted.
* **No group key.** Because each participant has an independent pairwise key, a member who leaves or is kicked
  simply has their session destroyed; they never held anyone else's key, so there is nothing to re-key for the
  remaining members. Keys still rotate (section 5) to bound the data protected by one key.
* **Server never answers an unauthenticated packet.** No reply to garbage means no reflection or amplification, and
  every reply is no larger than the packet that caused it.

## 2. Session establishment (over WebSocket)

Client to server, `call_join`:

```json
{ "channel_id": "...", "media": { "client_pub": "<base64 X25519 public key, 32 B>", "client_nonce": "<base64, 16 B>" } }
```

The server checks the user is an **active** member of the channel (kicked, banned or left members are refused), that
the room is not full, and replaces any previous call session of the same user. It then creates an ephemeral X25519
key pair and replies with `call_joined`:

```json
{ "channel_id": "...", "self_id": "<user id>",
  "media": { "session_id": "<base64 8 B>", "server_pub": "<base64 32 B>", "server_nonce": "<base64 16 B>",
             "media_id": 3, "max_packet": 1200, "epoch": 0 },
  "participants": [ { "user_id": "...", "username": "...", "media_id": 1, "track_states": {"audio": true} } ] }
```

`media_id` is a small per-room number the server stamps on forwarded media so receivers know the source. Other
members receive `call_participant_joined` (same participant shape) and `voice_update` as in WebRTC mode. Leaving
sends `call_participant_left`.

Why ECDH instead of sending a key over the WebSocket: the key never crosses the signalling channel, so a passive
eavesdropper on an HTTP/WS (non-TLS) LAN still learns nothing. Active MITM of an unprotected WebSocket is out of
scope (see threat model); deploy TLS on the WebSocket where possible.

## 3. Key schedule

```
shared = X25519(own_priv, peer_pub)
salt   = session_id(8) || client_nonce(16) || server_nonce(16)
prk0   = HKDF-Extract(SHA-256, shared, salt)
ctx    = "|" || channel_id || "|" || user_id          (binds the keys to the room and the user)
c2s_key  = HKDF-Expand(prk, "cove-udpmedia/v1/c2s/key"  || ctx, 32)
s2c_key  = HKDF-Expand(prk, "cove-udpmedia/v1/s2c/key"  || ctx, 32)
c2s_salt = HKDF-Expand(prk, "cove-udpmedia/v1/c2s/salt" || ctx, 4)
s2c_salt = HKDF-Expand(prk, "cove-udpmedia/v1/s2c/salt" || ctx, 4)
```

Ratchet to the next epoch: `prk(e+1) = HKDF-Extract(SHA-256, secret = prk(e), salt = "cove-udpmedia/v1/ratchet")`
then the four values above are re-derived. The old `prk` is overwritten, so a key compromised later cannot decrypt
earlier epochs.

Directions use different keys *and* different nonce salts, so a packet can never be reflected back at its sender
and verify.

## 4. Packet format

All integers big-endian. Maximum datagram: **1200 bytes** (safe under common LAN/VPN MTUs; larger datagrams are
dropped). Legacy packets start with a byte `0..3`; v1 packets start with `0xC1`, so the formats cannot be confused.

```
 0      1      2      3      4                 12                20
+------+------+------+------+-----------------+-----------------+----------------------+
| 0xC1 | type |epoch | 0x00 |  session_id (8) |    seq (8)      | ciphertext || tag(16)|
+------+------+------+------+-----------------+-----------------+----------------------+
 \________________ header = AEAD associated data (20 B) _______/
nonce = direction_salt(4) || seq(8)          (96-bit GCM nonce)
```

`seq` starts at 0 for each direction and each epoch and increases by one per packet. A (key, seq) pair is never
reused, because the key changes at every epoch and an epoch is retired well before `seq` reaches 2^32.

Types (inner plaintext in brackets):

| type | name | direction | plaintext |
|---|---|---|---|
| 1 | `HELLO` | c to s | `ts_ms(8)` padded with zeros to 64 B. Establishes the UDP address and doubles as keepalive and NAT-rebind probe. |
| 2 | `HELLO_ACK` | s to c | echoes `ts_ms`, padded to the same size as the HELLO it answers (never larger). |
| 3 | `MEDIA` | both | media header (18 B) + payload, below. |
| 4 | `NACK` | c to s | `src(2) kind(1) n(1)` then `n` x `frame_id(4) frag_idx(2)`; `n <= 32`. `frag_idx = 0xFFFF` means "all fragments". |
| 5 | `KEYFRAME_REQ` | c to s and s to c | `src(2) kind(1)`. From a receiver it names the publisher; the server forwards it to that publisher with `src` unused. |
| 6 | `BYE` | c to s | empty. Same effect as `call_leave`. |

Media header (inside the plaintext of type 3):

```
src(2)  kind(1)  codec(1)  flags(1)  rsv(1)  frame_id(4)  frag_idx(2)  frag_cnt(2)  ts(4)   = 18 B
```

* `src`: set by the server to the sender's `media_id`; ignored on uplink.
* `kind`: 1 audio, 2 camera video, 3 screen share.
* `codec`: 1 Opus, 2 VP8, 3 H.264 (Constrained Baseline, Annex-B), 4 VP9. Opaque to the server. Any receiver that
  does not implement a codec ignores the stream. Mandatory-to-implement: Opus and H.264 (hardware encoders exist on
  Android and desktops).
* `flags`: bit0 keyframe, bit1 discardable (non-reference frame).
* `frame_id`: increments by one per encoded frame per `(sender, kind)` and wraps. A frame is fragmented into at most
  `frag_cnt <= 64` packets of at most 1100 payload bytes (so the largest frame is 70 400 B; screen share keyframes
  larger than that must be encoded smaller).
* `ts`: sender clock in 1/1000 s (video) or sample count / 48 (audio); only differences matter.

## 5. Replay, ordering, rotation

* **Replay window:** 1024 packets per (direction, epoch), as in IPsec ESP. A packet is accepted only if its `seq` is
  inside the window and unseen; the window is advanced only after the tag verifies, so forged packets cannot move it.
* **Reorder:** anything inside the window is accepted in any order; the receiver's reassembler orders frames.
* **Epoch rotation:** `epoch` is one byte. Either side rotates after 10 minutes or 2^32 packets by sending its next
  packet under the ratcheted key with `epoch+1`. The peer accepts `epoch+1` only if the packet *authenticates* under
  the derived key, then ratchets as well and keeps the previous epoch for a 10 s grace period for reordered packets.
  Unauthenticated packets can never cause a ratchet.
* **Kick or leave:** the session is deleted immediately; its session id stops resolving and nothing more is
  accepted or sent. The server also re-checks membership of every session every 10 s, which covers removals that do
  not pass through the kick handler (banned, channel deleted, left on another device).

## 6. Handshake, liveness, DoS posture

1. After `call_joined` the client sends `HELLO` (>= 64 B plaintext) every 500 ms until a `HELLO_ACK` arrives, then
   every 5 s as keepalive (also needed to keep NAT bindings open).
2. The server learns the client's UDP address **only** from a `HELLO` that authenticates. The address then becomes
   the destination of that participant's media. A later authentic `HELLO` from a new address moves it (NAT rebind or
   roaming); media from any other address is dropped even if it authenticates.
3. A session that never says `HELLO` within 30 s, or is silent for 20 s, is removed and the client is told with
   `call_error`; it can join again.

Hardening (all enforced and tested):

| Threat | Control |
|---|---|
| Unauthenticated floods | Unknown session id: dropped with no reply and no crypto. Failing tags: dropped with no reply. Per-source-IP budget for packets from non-session addresses. |
| Reflection or amplification | Server only ever answers an authenticated `HELLO`, with a reply no larger than the request. |
| CPU exhaustion | Per-session token bucket charged before decryption (3000 pkt/s sustained, burst 6000); datagrams over 1200 B dropped before parsing; fragment and NACK counts bounded. |
| Memory exhaustion | Max sessions per user (1), per room (`voice.max_participants_per_call`), total sessions; bounded reassembly and NACK caches (512 packets per publisher stream). |
| Spoofing / injection | AES-GCM tag over header + payload; session id is 64 random bits and only resolves to the one user/room it was issued for; `src` is overwritten by the server. |
| Replay | Sliding window per direction and epoch. |
| Eavesdropping / tampering | AES-256-GCM, fresh keys per session via ephemeral ECDH. |
| NACK abuse | Per-session resend budget (500 pkt/s); resends go only to the requester. |
| Logging | Only user ids, channel ids and counters are logged; never keys, ECDH values, session ids, payloads or tokens. |

## 7. Loss and congestion handling

* **Audio:** Opus with in-band FEC and DTX; a lost audio packet is concealed, not retransmitted (NACK for audio is
  allowed but clients should not use it beyond 100 ms).
* **Video and screen share:** the receiver's reassembler detects missing fragments and missing frame ids and sends
  `NACK` (at most once per 40 ms per item, giving up after 300 ms). The server keeps the last 512 forwarded packets
  per publisher stream and resends them to the requester only. If a frame cannot be recovered the receiver sends
  `KEYFRAME_REQ`; the server forwards it to the publisher (at most one per 500 ms per stream). The existing
  `call_request_keyframe` WS event has the same effect.
* **No FEC for video in v1.** On a LAN, NACK round trips are a few ms; XOR FEC is a reserved extension (new
  `type`, additive).
* **No simulcast/bandwidth estimation in v1.** The sender should cap its bitrate (suggested 1.5 Mbit/s camera,
  3 Mbit/s screen) and back off when it receives many `KEYFRAME_REQ`. A `REPORT` packet (server to publisher with
  aggregate loss) is the planned follow-up.

## 8. Capability advertisement

`GET /api/version` and the WS `hello` event list, in `raw_udp` mode, the capabilities `raw_udp_voice` (existing) and
`raw_udp_media` (new). In `webrtc` mode they list `webrtc_sfu`. Clients decide from these, never from a version
number. The web client treats "no `webrtc_sfu` and `raw_udp_voice`/`raw_udp_media` present" as "calls need a native
client" and disables its call buttons (`calls.nativeRequired` in the i18n files).

## 9. Threat model (short)

In scope and defended: off-path attackers who can send arbitrary UDP at the server (spoofing, floods, replay,
amplification); passive eavesdroppers on the LAN; a channel member who was kicked or removed (loses media
immediately, never held others' keys); a registered user who is not a channel member (cannot join, no key is ever
issued).

Not defended:

* **The server is trusted.** It decrypts all media (same as the WebRTC SFU). A compromised server sees calls.
* **Active MITM on an unprotected WebSocket** can substitute the ECDH public keys during `call_join`. Use TLS on
  the WebSocket (the client may also pin the server). The signalling channel is the trust anchor, exactly as for
  WebRTC SDP fingerprints.
* **On-path attackers** can drop or delay packets, and can learn who talks to the server, packet sizes and timing
  (traffic analysis). Padding is applied only to `HELLO`.
* **Denial of service** by a network attacker that can saturate the link.
* A member can record the media they legitimately receive.

## 10. Implementation status

| Part | Status |
|---|---|
| Protocol library `pkg/udpmedia` (packets, AEAD, key schedule, rotation, replay window, fragmentation, reassembler with NACK/keyframe logic, UDP client) | Implemented, unit and loopback tested |
| Server router `internal/mediarouter` (WS signalling, handshake, forwarding, NACK cache, keyframe relay, rate limits, kick/eviction, membership sweep) | Implemented, tested including a multi-participant forwarding test with Go test clients |
| Removal of the old unencrypted audio-only router (`internal/voice`) | Done. Nothing listens on `server.udp_port` in `webrtc` mode, and legacy-format datagrams get no reply in `raw_udp` mode. The old desktop (`voice.go`) and Android (`RawUdpVoiceManager`) clients were deleted with it. |
| Capability advertisement, Swagger/docs | Implemented |
| Web client gating | Implemented (buttons disabled with explanation) |
| Desktop (Wails) | **Implemented, untested on real devices.** Go side: `client-desktop/media_bridge.go` (Wails binding `MediaBridge`, batched frame events) on top of `media_call.go`. Web side: `client-web/src/rtc/UdpMediaManager.ts` (WebCodecs Opus + H.264 Annex-B capture/encode/decode, canvas rendering into the existing tiles), selected only inside Wails on a `raw_udp_media` server. Covered by unit tests with a fake bridge and a loopback echo test; mic, camera, screen share and playback have **not** been run against a real server and devices. Screen-share audio is not sent. Needs a webview with WebCodecs encoders: WebView2 (Windows) is expected to work; WebKitGTK and WKWebView likely lack them (a Go-side codec would be the fallback, not built). |
| Android | **Implemented, untested on real devices.** Protocol layer in `client-android/.../data/udpmedia` (wire format, X25519 in plain Kotlin because the platform only has it from API 33, HKDF/AES-GCM keyring with epoch ratchet and replay window, fragmenter/reassembler with NACK and keyframe rules, UDP client), verified byte for byte against the vectors in `backend/tests/udpmedia_vectors_test.go` plus loss, reorder, replay, tamper and loopback tests. Engine in `rtc/udp` (`UdpCallManager`): Opus through Concentus (pure Java, with in-band FEC and DTX) with `AudioRecord`/`AudioTrack` and a jitter buffer; H.264 through libwebrtc's MediaCodec encoder and decoder wrappers fed by Camera2 and MediaProjection, decoded frames shown in the existing call tiles. `CallRouter` picks this engine per call when the server advertises `raw_udp_media` and not `webrtc_sfu`; otherwise the WebRTC engine runs unchanged. Not run against a real server and phone yet. |
