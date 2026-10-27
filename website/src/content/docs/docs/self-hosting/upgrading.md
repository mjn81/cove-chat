---
title: Upgrading
description: Safely move a Cove server to a new version.
---

1. **Back up** `data/` and `config.toml` ([Backups and restore](../backups-restore/)).
2. Read the [release notes](https://github.com/mjn81/nodetalk/releases) for breaking changes.
3. Replace the server.
   - Docker: change the image tag and run `docker compose pull && docker compose up -d`.
   - Binary: stop the service, replace the executable, start it again.
4. Update clients. The web client image and the server should be upgraded together.
5. Check the logs for startup errors, then sign in and send a test message.

## Rolling back

Stop the server, restore the previous binary or image tag and the `data/` backup taken in step 1. Do not run an older server against data that a newer version has already migrated.

## New config keys

New releases may add keys to `config.toml`. Missing keys use defaults, so your file keeps working. Compare with the newest [reference](../../configuration/reference/) after upgrading.
