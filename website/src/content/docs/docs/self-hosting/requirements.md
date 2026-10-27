---
title: Requirements
description: Hardware, software and network ports needed to host a Cove server.
---

## Hardware

Cove is a single Go process with an embedded database, so it runs comfortably on small machines. A VM with 1 CPU core, 1 GB of RAM and a few GB of disk is a reasonable start for a small community. Group calls are the main driver of CPU and bandwidth: the SFU forwards media without transcoding, so load grows with participants and video quality, not with chat volume.

Plan disk for uploads (`data/uploads`) and the database (`data/db`).

## Software

| Need | When |
|---|---|
| Docker with Compose | Recommended install path |
| A Linux, macOS or Windows host | Running the binary directly |
| Go 1.25, Node and pnpm | Building from source only |
| `ffmpeg` on `PATH` (or `server.ffmpeg_path`) | Optional, for video messages |
| A domain name and TLS certificate | Required for anything beyond a LAN |

## Network ports

| Port | Protocol | Purpose | Config key |
|---|---|---|---|
| 4000 | TCP | API and WebSocket | `server.http_port` |
| 3478 | UDP | Embedded STUN/TURN | `voice.embedded_turn_port` |
| 50000-50100 | UDP | WebRTC media | `voice.webrtc_port_min` / `voice.webrtc_port_max` |
| 9090 | UDP | Raw UDP voice (air-gapped mode only) | `server.udp_port` |
| 3000 | TCP | Web client container | compose file |

Open the UDP ports on your firewall and forward them if the server is behind NAT. See [Voice and calls](../../configuration/voice-and-calls/).
