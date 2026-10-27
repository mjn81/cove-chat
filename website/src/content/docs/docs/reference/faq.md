---
title: FAQ
description: Answers to common questions about running and using Cove.
---

## Is Cove end-to-end encrypted?

Messages are encrypted in the client and stored encrypted, but the server manages channel keys, so the server operator can read them. Whisper chats are true end-to-end encrypted and never stored. See [Encryption model](../../security/encryption-model/).

## What does the first account do?

The first account registered on a fresh server becomes the owner.

## Can I run Cove without internet access?

Yes. Use `voice.mode = "raw_udp"` for audio calls on an isolated LAN.

## How do I change the port?

Set `server.http_port` in `config.toml` and update your reverse proxy and `VITE_API_URL`.

## Where is my data?

In the `data/` directory next to the server: the database in `data/db` and uploads in `data/uploads`.

## Can servers talk to each other?

Not yet. Federation is on the [roadmap](https://github.com/mjn81/nodetalk/blob/main/TODO.md).

## What license is Cove under?

MIT.
