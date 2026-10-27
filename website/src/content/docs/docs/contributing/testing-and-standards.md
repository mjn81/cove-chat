---
title: Testing and standards
description: How to test changes and the coding standards Cove follows.
---

## Before you open a pull request

| Area | Commands |
|---|---|
| Backend | `make test` (race detector on), `make lint`, `make swagger` if handler annotations changed |
| Web client | `make front/typecheck`, `make front/lint`, `make front/test` |
| Website | `make site/typecheck`, `make site/build` |

## Backend

- Write a failing test first, in `backend/tests/` (package `tests`), then implement.
- Test through exported APIs with a real BadgerDB in a temp directory. Do not mock the store.
- Every handler change covers the happy path, validation failure, unauthenticated (401) and insufficient role (403).
- Every route is at least authenticated. Public routes are the exception and need explicit approval.
- Every handler has a full Swagger block with an `**Access:**` line. Regenerate with `make swagger`.
- Use the project `logger` package, never `fmt.Print`. Never log secrets, tokens or message bodies.

## Web client

- Shadcn components first, theme tokens only (no raw colors), lucide icons.
- Every user-facing string goes through i18n and exists in `en.json`, `fa.json` and `ar.json`.
- Use logical Tailwind classes (`ms-*`, `ps-*`, `start-*`) so right-to-left works.
- Server state lives in React Query, UI state in Zustand.
- No `any`. Use `unknown` and narrow it.

## Commit and review

Keep pull requests focused. Describe the behavior change, not just the diff, and note anything you could not verify.
