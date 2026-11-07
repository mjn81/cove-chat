---
title: Voice and calls
description: WebRTC SFU versus the encrypted UDP media router, TURN, public IP and firewall setup for calls.
---

Cove has two call engines, selected by `voice.mode`.

| | `webrtc` (default) | `raw_udp` |
|---|---|---|
| Audio | Yes | Yes |
| Video and screen share | Yes | Yes (native clients only) |
| Encryption | DTLS-SRTP | AES-256-GCM per session (docs/udp-media.md) |
| Web client | Yes | No: call buttons are disabled; use the desktop or Android app |
| NAT traversal | ICE, STUN and embedded TURN | None; clients must reach the server directly |
| Best for | Internet-facing servers | Air-gapped or trusted LANs |

## WebRTC mode

The server runs a selective forwarding unit (SFU): each participant publishes once and the server forwards streams to the others.

1. **Open the ports.** UDP `voice.webrtc_port_min` to `voice.webrtc_port_max` (default 50000-50100) and, if TURN is enabled, UDP `voice.embedded_turn_port` (default 3478).
2. **Tell clients where you are.** Behind NAT, a cloud load balancer or a Docker port mapping, set `voice.public_ip`:
   - `"auto"` (default) discovers it with a one-time STUN query at startup
   - `"1.2.3.4"` sets it explicitly
   - `""` is for LAN-only deployments and never calls out
3. **Keep embedded TURN on** (`voice.embedded_turn_enabled = true`) unless every client is on the same LAN. It relays media for users behind restrictive NATs using short-lived, per-call credentials derived from `voice.turn_shared_secret`.
4. **Cap the room size** with `voice.max_participants_per_call`.

Browsers only allow microphone, camera and screen capture on HTTPS (or localhost). See [Reverse proxy and TLS](../../self-hosting/reverse-proxy-tls/).

## Raw UDP mode

```toml
[voice]
mode = "raw_udp"
```

Calls run on the encrypted UDP media router (audio, video and screen share, AES-256-GCM per session; see `docs/udp-media.md`) on UDP port `server.udp_port` (default 9090), with no ICE, STUN or TURN. Use it on isolated networks with no internet egress. In `webrtc` mode nothing listens on `server.udp_port`.

Only native clients can speak it. The Windows desktop app can place and join these calls (audio, camera and screen share; it needs the webview's WebCodecs support, which is still being tested on real hardware). The Android app can too (audio, camera and screen share; tested on an emulator against a test client, not yet on real phones). The web client disables its call buttons because a browser cannot do raw UDP. The older unencrypted, audio-only UDP format has been removed.

## Troubleshooting

- **Everyone connects but there is no audio.** The media ports are blocked or `voice.public_ip` is wrong.
- **Works on LAN, fails from outside.** Forward the UDP range and TURN port, and confirm `public_ip`.
- **Docker.** Publish the UDP range with `-p 50000-50100:50000-50100/udp`; the container must advertise the host's public IP.
