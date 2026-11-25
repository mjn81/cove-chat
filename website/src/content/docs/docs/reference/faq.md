---
title: FAQ
description: Answers to common questions about running and using Cove.
---

## Is Cove end-to-end encrypted?

Messages are encrypted in the client and stored encrypted, but the server manages channel keys, so the server operator can read them. Whisper chats are true end-to-end encrypted and never stored. See [Encryption model](../../security/encryption-model/).

## What does the first account do?

The first account registered on a fresh server becomes the owner.

## Can I run Cove without internet access?

Yes. Use `voice.mode = "raw_udp"` for encrypted calls on an isolated LAN. Calls in that mode need a native client (desktop or Android), not the browser.

## How do I change the port?

Set `server.http_port` in `config.toml` and update your reverse proxy and `VITE_API_URL`.

## Where is my data?

In the `data/` directory next to the server: the database in `data/db` and uploads in `data/uploads`.

## Can servers talk to each other?

Not yet. Federation is on the [roadmap](https://github.com/mjn81/cove-chat#roadmap).

## What license is Cove under?

Cove uses the **Cove Community License**. It is free for individuals, communities and small teams, and it is share-alike: if you change it and distribute it or run it for others, you must publish your source under the same license. Reselling it, use by large organizations (more than 200 people or USD 1M revenue) and government use need written permission from the creator. See the [LICENSE](https://github.com/mjn81/cove-chat/blob/main/LICENSE).
