---
title: Admin panel
description: Owner and admin tools for managing a Cove server from the web client.
---

Owners and admins see a **Server admin** tab in Settings. The panel is optional: everything it does can also be done by editing `config.toml`.

## Who sees it

| Role | How you get it | Can do |
|---|---|---|
| **Owner** | First account on a fresh server, or `admin.owner_username` recovery | Everything below, plus manage admins, backups, reset, delete and transfer ownership |
| **Admin** | Granted by the owner | Overview, registration mode, invites, non-sensitive settings, audit log |
| Everyone else | | Nothing. Every `/api/admin/*` route returns 403 |

Roles are checked on the server on every request. Revoking an admin takes effect immediately.

## What it can do

- **Registration:** switch between open, invite-only and closed, and create invitation codes.
- **Settings:** edit a whitelist of `config.toml` keys. Comments in the file are preserved and a `.bak` of the previous file is kept. Secrets are never shown. Network and session-security keys are owner-only.
- **Audit log:** recent admin actions.
- **Owner tools:** download an encrypted backup, reset data (keeps the owner account), delete the server, add or remove admins. Each asks for the owner's password again; reset and delete also require typing a confirmation.

## Recovering a lost owner login

Set `admin.owner_username = "name"` in `config.toml` and restart. See [Backups and restore](../../self-hosting/backups-restore/).
