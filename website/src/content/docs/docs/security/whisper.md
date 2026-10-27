---
title: Whisper
description: Zero-persistence, end-to-end encrypted chats, and their limits.
---

Whisper is Cove's mode for conversations that must not leave a trace on the server.

## Guarantees

- **End-to-end encrypted.** Keys are ephemeral and exist only on the participants' devices.
- **Zero persistence.** The server never writes Whisper plaintext or keys to disk. Content lives in memory and is wiped when the session ends.
- **Not recoverable.** There is no history to restore, by design.

## Limits

- Participants can still screenshot, copy or otherwise record what they see.
- The server learns metadata that is needed to route messages, such as who is connected.
- Messages are gone for everyone when the session ends, including for people who were offline.

## When to use it

Sharing a one-time secret, discussing something sensitive with people who need it only briefly, or any case where you would not want the operator of the server to be able to read it later.
