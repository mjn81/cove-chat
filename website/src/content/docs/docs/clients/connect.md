---
title: Connect a client to a server
description: Point the Cove desktop and Android apps (or the web client) at your own server, or try the public demo.
---

Every Cove client asks for a **server address** on first launch. This page explains what to type, how the apps check it, and what your server and proxy must provide so that just a domain name is enough.

## Try the public demo

Want to look around before installing a server? Use the demo at **`demo.covechat.dev`**.

- Desktop and web: on the server screen press **Use the public demo server**, or type `demo.covechat.dev`.
- Android: type `demo.covechat.dev` and press **Connect**.
- Open the web client directly at [demo.covechat.dev](https://demo.covechat.dev).

The demo is public and limited (account caps, small uploads, short calls) and **resets every night**. Never enter anything private.

## What to type

| You type | What the app tries |
|---|---|
| `chat.example.com` | `https://chat.example.com` first, then `http://chat.example.com` |
| `https://chat.example.com` | exactly that, nothing else |
| `192.168.1.20:4000`, `localhost:4000`, `nas.local` | `http://` first (local and LAN addresses rarely have a public certificate), then `https://` |
| `chat.example.com:8443` | `http://` first, then `https://`, because an explicit port is usually a direct, non-proxied server |

Paths and trailing slashes are ignored. The app asks the candidate for `/api/version`, uses the first that answers like a Cove server, and saves that address. If none answers you get one error and can fix the address.

:::note
Why https first? A server behind a TLS proxy answers plain `http` with a redirect to `https`. REST calls follow the redirect, but the WebSocket that carries messages and calls does not, so an `http` address would look connected and then never deliver anything. Trying `https` first avoids that.
:::

## What your server needs

The apps use **one address for everything**: the REST API at `/api/*` and the WebSocket at `/ws` on the same host. With a reverse proxy this means:

1. A DNS record for your domain pointing at the server.
2. HTTPS on that domain (Caddy gets and renews certificates by itself, which makes it the easiest choice).
3. `/api/*` **and** `/ws` forwarded to the Cove server, with WebSocket upgrades allowed. Everything else can go to the web client.
4. Call media is **not** proxied: open the WebRTC UDP range and TURN port directly (see [Reverse proxy and TLS](/docs/self-hosting/reverse-proxy-tls/)).

A complete Caddy setup for the whole domain:

```text title="Caddyfile"
chat.example.com {
    @backend path /api/* /ws
    handle @backend {
        reverse_proxy cove-server:4000
    }
    handle {
        reverse_proxy cove-webclient:80
    }
}
```

And in the server's `config.toml`:

```toml
[server]
domain = "chat.example.com"
frontend_origin = "https://chat.example.com"
trust_proxy_headers = true   # only when a proxy you control sits in front
```

`trust_proxy_headers` lets rate limits and sign-up limits see the real client address instead of the proxy's. Leave it `false` when clients connect to the server directly, because clients could then spoof their address.

## Web client

The browser build talks to the origin it was built for. In the Docker image set `VITE_API_URL` to the public address (for example `https://chat.example.com`) and the container rewrites it at start. With the Caddy layout above the web client and the API share one origin, so cookies and CORS just work.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Could not connect to the server" immediately | Wrong host, DNS not yet propagated, or the certificate is not issued yet (check `docker logs` of your proxy) |
| Connects, but messages never arrive or the status stays offline | `/ws` is not forwarded to the server, or the proxy drops `Upgrade` headers |
| Works on Wi-Fi at home, not on mobile data | Only the LAN address was opened; publish a real domain and port 443 |
| Calls connect but there is no audio or video | The UDP media range or port 3478/udp is blocked; see the firewall notes in the self-hosting guide |
| The app works over `http://` but you worry about privacy | Plain `http` is allowed for LAN and test servers but is not encrypted in transit; use an HTTPS domain for anything on the internet |

## Related

- [Reverse proxy and TLS](/docs/self-hosting/reverse-proxy-tls/)
- [Docker deployment](/docs/self-hosting/docker/)
- [Android app](/docs/clients/android/) and [Desktop app](/docs/clients/desktop/)
