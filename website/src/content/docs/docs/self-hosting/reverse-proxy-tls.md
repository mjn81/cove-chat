---
title: Reverse proxy and TLS
description: Put Cove behind Caddy or nginx with HTTPS, and what must stay outside the proxy.
---

Browsers need HTTPS for microphone, camera and screen capture, so anything beyond localhost should sit behind TLS.

## What the proxy handles, and what it cannot

| Traffic | Through the proxy? |
|---|---|
| Web client static files | Yes |
| REST API (`/api/*`) | Yes |
| WebSocket | Yes, but the proxy must forward `Upgrade` headers |
| WebRTC media (UDP 50000-50100) | **No.** Expose these ports directly |
| TURN (UDP 3478) | **No.** Expose directly |

## Caddy

Caddy obtains certificates automatically and proxies WebSockets with no extra configuration.

```text title="Caddyfile"
chat.example.com {
    handle /api/* {
        reverse_proxy localhost:4000
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

With this layout set `VITE_API_URL=https://chat.example.com` and `server.frontend_origin = "https://chat.example.com"`.

## nginx

```nginx title="/etc/nginx/conf.d/cove.conf"
server {
    listen 443 ssl http2;
    server_name chat.example.com;
    # ssl_certificate / ssl_certificate_key from certbot or your CA

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;   # keep long-lived WebSockets open
        client_max_body_size 110m;  # at least server.max_file_size_mb
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

## Checklist

- `server.frontend_origin` exactly matches the origin users open in the browser, scheme included.
- `voice.public_ip` is set (or `auto`) so clients receive a reachable media address.
- The proxy's upload limit is at least `server.max_file_size_mb`.
- Test sign-in through the final public URL, since session cookies are tied to the origin.
