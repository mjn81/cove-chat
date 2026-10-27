---
title: Voice and calls
description: WebRTC SFU versus raw UDP, TURN, public IP and firewall setup for calls.
---

Cove has two call engines, selected by `voice.mode`.

| | `webrtc` (default) | `raw_udp` |
|---|---|---|
| Audio | Yes | Yes |
| Video and screen share | Yes | No |
| Encryption | DTLS-SRTP | None |
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

Audio flows over UDP port `server.udp_port` (default 9090) with no ICE, STUN or TURN. Use it on isolated networks with no internet egress. The desktop client supports it; calls have no video or screen sharing.

## Troubleshooting

- **Everyone connects but there is no audio.** The media ports are blocked or `voice.public_ip` is wrong.
- **Works on LAN, fails from outside.** Forward the UDP range and TURN port, and confirm `public_ip`.
- **Docker.** Publish the UDP range with `-p 50000-50100:50000-50100/udp`; the container must advertise the host's public IP.
