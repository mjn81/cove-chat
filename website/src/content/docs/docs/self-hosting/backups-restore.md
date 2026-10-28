---
title: Backups and restore
description: What to back up, how the owner downloads an encrypted backup, and how to restore it.
---

## What to back up

| Item | Why |
|---|---|
| `data/` (database in `data/db`, uploads in `data/uploads`) | All server state |
| `config.toml` | Includes the master password and TURN secret generated on first start |

:::danger
Without the master password the database cannot be decrypted. Store it in a password manager, separately from the data backups.
:::

## Admin panel backup

The server owner can download an **encrypted backup** from the *Server admin* tab. It asks for the owner's password and a backup passphrase you choose. The file ends in `.cove-backup`.

## Restore

Stop the server, then restore into an empty data directory:

```bash
COVE_BACKUP_PASSPHRASE='your passphrase' ./cove-server restore file.cove-backup
```

If the database already has data the command refuses to run. Add `--force` to merge the backup into existing data.

## File-level backups

For disk snapshots or `rsync`, stop the server (or snapshot the filesystem atomically) so BadgerDB files are consistent.

## Lost owner login

Set `admin.owner_username` in `config.toml` to an existing username and restart. That account becomes the owner and the previous owner becomes an admin.
