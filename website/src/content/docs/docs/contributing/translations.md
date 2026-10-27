---
title: Translations
description: Add or improve a language in the Cove web client.
---

Translations live in `client-web/src/i18n/locales/` as `en.json`, `fa.json` and `ar.json`.

1. Add or change the key in **all three** files. Provide a real translation, not English copy.
2. Group keys by domain, for example `channels.create.title`.
3. Run `make front/test`. `src/i18n/locales.test.ts` fails if any file is missing a key.

## Right-to-left

Arabic renders right-to-left. By product decision Persian currently swaps text only and stays left-to-right. Write layouts with logical Tailwind classes so either direction works.

## Adding a new language

Open an issue first so the approach (file, direction, fonts) can be agreed. The language list and direction handling live in `client-web/src/i18n/index.ts`.
