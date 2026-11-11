# Example bot (Go)

A small bot for a Cove server using only the standard library and one WebSocket package. It shows the Bot API end to end: slash commands, interaction answers, buttons on a message (a counter), the keyboard-replacing action menu, mentions, and both ways to receive events (gateway or signed webhooks). See [docs/bots-api.md](../../docs/bots-api.md) for the API and the website guide "Build your first bot".

## Run it

1. In Cove open **Settings > Bots > Create bot** (on a default server only admins can; an admin can allow everyone with `bots.creation = users`). Copy the **token**; it is shown once.
2. Open a channel you administer, **channel settings > Bots > Add a bot**, pick the bot and grant at least *Send messages*.
3. Start the bot:

```bash
COVE_URL=https://chat.example.com COVE_BOT_TOKEN='<id>.<secret>' go run .
```

4. In the channel type `/ping`, `/roll`, `/counter` or `/menu`, or mention the bot with `@yourbot`.

## Local dev: seed and run

```bash
make dev-back        # your local server
make dev-seed-bots   # creates the public bot "covebot", #bot-lab and #bot-lab-2 (bot installed), welcome messages; idempotent
make dev-bot         # runs the bot with the token the seed saved in examples/bot-go/.env.local
```

The seed uses `COVE_SEED_USER` / `COVE_SEED_PASSWORD` if set, otherwise the account in `.dev-seed.local`, otherwise it registers `botdev` with a random password (printed once and saved there). Both files and `.env.local` are git-ignored. On a server that already has an owner, `botdev` is a normal user: let it create bots (admin panel > Bots, or `bots.creation = "users"`) or seed with an admin account.
Try `/ping`, `/roll 20`, `/poll "Lunch?"`, `/counter`, `/menu`, press the buttons, or find the bot under Explore > Bots and press Message.

## Webhook mode

If the bot cannot keep a connection open, give it a public HTTPS address in the bot's settings (the server only calls `https://` addresses, and never private ones unless the server owner allowed it with `bots.webhook_allow_private`). Copy the webhook signing secret shown when you save it, then:

```bash
COVE_URL=https://chat.example.com COVE_BOT_TOKEN='<id>.<secret>' \
COVE_WEBHOOK_ADDR=:8080 COVE_WEBHOOK_SECRET='whsec_…' go run .
```

The handler verifies `X-Cove-Signature` (HMAC-SHA256 of `timestamp + "." + body`) in constant time and rejects old timestamps before doing anything else.

## What to change for a real bot

- Keep state in a database; this example keeps the counters in memory.
- The bot never handles encryption: the server encrypts and decrypts for it, only in channels where it is installed. Install it only where you accept that its owner can read the messages its scopes allow.
- Never log the token, the webhook secret or message text.
