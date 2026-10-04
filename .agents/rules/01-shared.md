---
trigger: always_on
description: Full-stack practices for NodeTalk — commands, package management, DRY, documentation, comments, typing.
---

# Shared Practices (Full Stack)

## Commands & packages

- **Makefile first.** Every build/test/lint/codegen command goes through `make <target>`. Don't type the underlying `go`/`pnpm` command manually when a target exists. If you need a command repeatedly and no target exists, add one to the `Makefile` (with a `## description` so it shows in `make help`).
- **Package manager: `pnpm` only** (version pinned by `packageManager` in `client-web/package.json`; enable with `corepack enable`). Never run `npm`, `npx`, or `yarn`, and never commit a `package-lock.json` or `yarn.lock`.
  - Install deps: `make front/install` (`pnpm install --frozen-lockfile`).
  - Add a dependency: `pnpm -C client-web add <pkg>` (`add -D` for dev deps), then commit `pnpm-lock.yaml`.
  - One-off CLIs: `pnpm dlx <tool>` (instead of `npx`); local binaries: `pnpm -C client-web exec <bin>`.
  - pnpm settings live in `client-web/pnpm-workspace.yaml`, not `.npmrc`. Peer conflicts get a **scoped** `peerDependencyRules.allowedVersions` entry (never a global legacy-peer-deps style switch). Dependency install scripts are blocked by default; allowlist one in `allowBuilds` only when it is genuinely required.
- **Go deps:** add with `go get` inside `backend/`, then `make tidy`.

## DRY & reuse

- If conditional logic or a data transformation is needed in more than one place, extract it into a **pure function**.
- Before writing a utility, search the existing homes first:
  - Frontend: `client-web/src/lib/`, `client-web/src/utils/`, `client-web/src/hooks/`, and the relevant `src/domains/<domain>/`.
  - Backend: `backend/internal/api/utils.go`, `internal/crypto`, `internal/auth`, `internal/store`, `internal/middleware`.
- Reuse and extend existing code rather than writing a near-duplicate.

## Documentation

- **TypeScript:** JSDoc on every exported function, hook, component, and non-trivial type (`@param`, `@returns`, and `@throws` where relevant) so IntelliSense is useful.
- **Go:** a doc comment on every exported identifier, starting with its name (`// Require wraps …`). Every package has a `// Package x …` comment.

## Comments

- Don't state the obvious (`// fetch data`, `// increment i`).
- Do explain the **why**: non-obvious constraints, security decisions, protocol quirks, regex intent, ordering/concurrency requirements, and workarounds. The existing codebase does this well (e.g. the SameSite note in `client-web/src/api/client.ts`) — match that style.

## Typing

- **TypeScript:** never use `any`. Use `unknown` and narrow it (type guards, zod parsing) when a type is genuinely undefined or hard to define. Prefer precise types otherwise.
- **Go:** avoid `any`/`interface{}` in signatures except at true serialization boundaries (e.g. `writeJSON`). Use concrete structs for request/response bodies.

## Tests location

- **Backend:** all new tests go in the unified `backend/tests/` folder (package `tests`), run with `make test`. Design code so behaviour is testable through exported APIs rather than adding in-package `_test.go` files.
- **Frontend:** colocated `*.test.ts(x)` next to the code under test (Vitest + Testing Library, jsdom, setup in `src/test/setup.ts`), run with `make front/test`.

## Before you say "done"

Run what applies and report results honestly (including failures):

- Backend: `make test`, `make lint`, and `make swagger` if any handler annotation changed.
- Frontend: `make front/typecheck`, `make front/lint`, `make front/test`.
- i18n: every new key exists in `en.json`, `fa.json`, and `ar.json` (`src/i18n/locales.test.ts` enforces parity).
