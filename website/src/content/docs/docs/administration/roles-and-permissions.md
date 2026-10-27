---
title: Roles and permissions
description: Server roles, channel roles and how access is enforced.
---

There are two independent role systems.

## Server roles

`owner`, `admin` or none. They gate the admin panel and the `/api/admin/*` routes. See [Admin panel](../admin-panel/).

## Channel roles

| Role | Value | Typical rights |
|---|---|---|
| Member | 0 | Read and post in the channel |
| Admin | 10 | Manage members and channel settings |
| Owner | 20 | Everything in the channel, including changing roles |

## Access tiers

Every API route belongs to exactly one tier, and the access level is listed per endpoint in the [REST API reference](../../api/rest/).

| Tier | Requirement |
|---|---|
| Public | None (version, register, login only) |
| Authenticated | Valid session cookie (plus CSRF token on mutations) or Bearer token |
| Channel Member | Membership of the channel in the path |
| Channel Admin / Owner | Channel role check on top of membership |
| Server Admin / Owner | Server role check, re-read from the database each request |

Failures return `401` for missing or invalid authentication and `403` for insufficient access. WebSocket and call signaling messages apply the same checks as their REST equivalents.
