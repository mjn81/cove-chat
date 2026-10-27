---
title: Registration and invites
description: Control who can create an account on your server.
---

The `[registration]` section sets the starting policy. Admins can change it live from the admin panel.

| `registration.mode` | Who can sign up |
|---|---|
| `open` | Anyone who can reach the server |
| `invite_only` | Only people with a valid invitation code |
| `closed` | Nobody |

The **first account on a fresh server is always allowed**, whatever the mode. It becomes the owner.

## Invitation codes

Create codes in the admin panel, or declare them in `config.toml`:

```toml
[[registration.invites]]
code       = "WELCOME-2026"
max_uses   = 10                    # 0 = unlimited
expires_at = "2026-12-31T23:59:59Z" # optional, RFC 3339
note       = "launch party"
```

Codes declared in the file are synced into the database on every start. Remove one from the file to revoke it. Invites created in the panel are separate and are not affected.

## Rate limiting

Sign-in and registration are limited by `rate_limit.auth_rps` per IP address, on top of the global `rate_limit.global_rps`. Wrong passwords on owner-only actions count against the same limit.
