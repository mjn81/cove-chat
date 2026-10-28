---
title: Sign-up protection (ALTCHA)
description: Stop bots and mass sign-ups on your own server with a self-hosted proof-of-work check that every Cove client solves automatically.
---

An open server can be flooded with fake accounts. Cove includes a **self-hosted proof-of-work check** for sign-ups, built on the open [ALTCHA](https://altcha.org) format. It is off by default and any admin can switch it on.

## How it works

1. A client that opens the register form asks the server for a **challenge**: a random value plus a number range.
2. The client does a small amount of CPU work: it searches the range for the number whose SHA-256 hash matches the challenge. This takes well under a second on a normal device.
3. It sends the result with the registration. The server checks the signature, the hash, the expiry and that the solution was **not used before**.

For one person registering once, the cost is invisible. For a script creating thousands of accounts it adds up quickly, because every account needs its own fresh solution.

| | |
|---|---|
| Third parties | None. No external service, no cookies, no tracking, no data leaves your server. |
| User interaction | None. The apps solve it in the background and show a short "Checking that you are human" line. |
| Works in | Web, desktop and Android clients, all with built-in solvers. |
| First account | Always exempt, so you can set up a fresh server. |

## Turn it on

**From the admin panel (no restart):** open **Admin → Settings → Security** and switch on **Sign-up check**. You can also choose the difficulty there. Changes apply immediately.

**From `config.toml`:**

```toml
[captcha]
enabled = true
difficulty = "medium"   # low | medium | high
```

| Difficulty | Average work per sign-up | Typical time |
|---|---|---|
| `low` | about 12,000 hashes | a few milliseconds |
| `medium` (default) | about 50,000 hashes | under half a second |
| `high` | about 200,000 hashes | around a second on a phone |

Raise the difficulty if you see abuse; lower it if people on very old devices complain.

## What clients see

Clients learn about the check from the public `GET /api/server-info` response (`captcha_required: true`), so an old client that does not know about it simply gets a clear error from the server instead of a broken form. Current Cove clients solve it on their own and enable the register button when the check finishes. If solving fails, they offer **Try again**.

## Good to know

- **Replay protection and restarts:** solved challenges are remembered in memory until they expire (five minutes). Restarting the server also invalidates challenges that were issued before the restart; clients just fetch a new one.
- **Combine it with other limits:** this check raises the cost of abuse but does not replace the sign-up mode (`open`, `invite_only`, `closed`), the per-IP rate limits (`rate_limit.auth_rps`) or, for public demos, the `[demo]` caps. See [Configuration](/docs/configuration/reference/).
- **Behind a proxy:** set `server.trust_proxy_headers = true` when a proxy you control sits in front, so rate limits see the real client address.
- **Third-party clients:** the API is the standard ALTCHA v1 format, so the official ALTCHA widget works against `GET /api/captcha/challenge` too.

## API

```text
GET  /api/captcha/challenge   → { algorithm, challenge, maxnumber, salt, signature }   (404 when disabled)
POST /api/register            { username, password, captcha: "<base64 JSON>" }
```

The `captcha` value is the base64 of `{"algorithm":"SHA-256","challenge":…,"number":…,"salt":…,"signature":…}`. Errors are `auth.errors.captcha_required` (400, missing) and `auth.errors.captcha_failed` (403, invalid, expired or reused). See the [REST reference](/docs/api/rest/).
