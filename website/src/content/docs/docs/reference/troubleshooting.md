---
title: Troubleshooting
description: Fixes for the most common Cove setup problems.
---

## The web client loads but cannot sign in

- `server.frontend_origin` must exactly match the address in the browser, including `https://` and any port.
- `VITE_API_URL` must be reachable from the browser, not only from the container.
- Check the browser's network tab for blocked CORS or mixed-content requests.

## Messages do not arrive in real time

The WebSocket is being blocked. Behind a proxy, forward `Upgrade` and `Connection` headers and raise the read timeout. See [Reverse proxy and TLS](../../self-hosting/reverse-proxy-tls/).

## Calls connect but there is no audio or video

Open UDP `50000-50100` and `3478`, and set `voice.public_ip`. See [Voice and calls](../../configuration/voice-and-calls/).

## The browser will not share the microphone, camera or screen

These require HTTPS or localhost.

## The server will not start after I changed config.toml

Check the log for the first error. Compare keys against the [reference](../../configuration/reference/). A `.bak` copy is kept when the admin panel edits the file.

## I lost the master password

The database cannot be decrypted without it. Restore from a backup that includes `config.toml`.

## Large uploads fail

Raise `server.max_file_size_mb` and the proxy's body limit (`client_max_body_size` in nginx).
