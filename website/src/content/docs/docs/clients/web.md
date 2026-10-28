---
title: Web client
description: Serve and use the Cove web client.
---

The web client is a static React app. It needs to know where your API lives.

## Docker

Use the `mjn81/cove-webclient` image and set `VITE_API_URL`. See [Docker and Compose](../../self-hosting/docker/).

## Static hosting

```bash
make front/install
VITE_API_URL=https://chat.example.com make front/build
```

Upload `client-web/dist/` to any static host. Configure it to fall back to `index.html` for unknown paths (single-page app routing). Remember `server.frontend_origin` must match the origin the site is served from.

## Browser requirements

Current versions of Chrome, Edge, Firefox and Safari. Calls, voice notes and screen sharing require HTTPS.

## Sign-in

Web sessions use an httpOnly cookie with CSRF protection, so no tokens are stored in local storage.
