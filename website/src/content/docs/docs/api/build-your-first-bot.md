---
title: Build your first bot
description: Create a bot, install it in a channel, answer a slash command and add buttons, in about ten minutes.
sidebar:
  order: 2
---

This guide takes you from nothing to a bot that answers `/ping`, shows a counter with a button and offers a menu that replaces the keyboard. The full reference is [Bots](/docs/api/bots/); a complete runnable version of this guide is the [example bot](https://github.com/mjn81/cove/tree/main/examples/bot-go) in the repository.

## 1. Create the bot and get a token

Open **Settings > Bots > Create bot**. On a default server only admins can create bots; an admin can let everyone with the setting `bots.creation = users` in the admin panel. Give it a lowercase name such as `pingbot` and copy the token that appears: it is shown **once**. If you lose it, rotate it from the bot's settings.

A token looks like `<bot_id>.<secret>`. Every request carries it:

```http
Authorization: Bot <bot_id>.<secret>
```

```bash
curl -H "Authorization: Bot $TOKEN" https://chat.example.com/api/bots/me
```

## 2. Install it in a channel

In a channel you administer open **channel settings > Bots > Add a bot**, pick `pingbot` and choose what it may do. The default is **Send messages** only. Add **Read all messages** if the bot must see every message instead of only the ones that mention it, and **See members** to know who joins. Bots are never admins.

## 3. Register a command

```bash
curl -X PUT -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \
  https://chat.example.com/api/bots/me/commands \
  -d '{"commands":[{"name":"ping","description":"Check that the bot is alive"}]}'
```

Type `/` in the channel: `/ping` appears in the autocomplete.

## 4. Receive events

Connect a WebSocket to `/gateway/bot` with the same `Authorization` header (or give the bot a public HTTPS webhook in its settings and handle signed POSTs). In Go:

```go
conn, _, err := websocket.Dial(ctx, "wss://chat.example.com/gateway/bot", &websocket.DialOptions{
	HTTPHeader: http.Header{"Authorization": {"Bot " + token}},
})
for {
	_, data, err := conn.Read(ctx)
	// data is {"id","type","bot_id","payload"}; "hello" comes first
}
```

When someone runs `/ping` you receive:

```json
{ "type": "interaction_create", "payload": {
    "id": "7c1…", "token": "Qx…", "type": "command", "channel_id": "…",
    "user": { "id": "…", "username": "alice" }, "data": { "name": "ping", "options": {} } } }
```

## 5. Answer it

```bash
curl -X POST -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \
  https://chat.example.com/api/interactions/$ID/$INTERACTION_TOKEN/callback \
  -d '{"type":"message","text":"Pong!"}'
```

You have 15 minutes and two answers per interaction (for example `ack` now and a message later).

## 6. Add buttons

```bash
curl -X POST -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \
  https://chat.example.com/api/bots/me/channels/$CHANNEL/messages \
  -d '{"text":"Count: 0","buttons":[[{"label":"+1","style":"primary","custom_id":"inc"}]]}'
```

Pressing the button sends you an `interaction_create` with `type: "button"`, `data.custom_id: "inc"` and the `message_id`. Answer with `{"type":"update_message","text":"Count: 1","buttons":[…]}` to edit the same message. Link buttons use `"url": "https://…"` instead of `custom_id`.

## 7. Replace the keyboard with a menu

```bash
curl -X PUT -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \
  https://chat.example.com/api/bots/me/channels/$CHANNEL/keyboard \
  -d '{"rows":[[{"label":"Roll d6","custom_id":"roll6"},{"label":"Roll d20","custom_id":"roll20"}]],"placeholder":"Pick an action","persistent":true}'
```

For everyone in the channel the message box is replaced by that button grid until you `DELETE` the keyboard, a person switches back to typing, or (with `"one_time": true`) after the first press. Presses reach the bot as `keyboard` interactions.

## Things to know

- **Encryption.** You never handle keys. You send and receive plaintext over TLS; the server encrypts and decrypts for the channels the bot is installed in. The people who install your bot should know you can read what its scopes allow.
- **Limits.** 5 messages per second per channel, 4000 characters per message, 5x5 buttons, 100 commands. The full table is in [Bots](/docs/api/bots/#3-authentication-errors-limits).
- **Be ready for restarts.** The gateway is not a queue: after reconnecting, read history (`messages.read`) if you must not miss messages. Webhooks are retried for a few minutes only.
