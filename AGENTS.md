# AGENTS.md — NodeTalk

Instructions for AI coding agents (Codex, Cursor, Copilot, Gemini/Antigravity, Claude, etc.).

**The canonical development guidelines live in [`.agents/rules/`](.agents/rules/). Read them before writing code:**

1. [`00-project-overview.md`](.agents/rules/00-project-overview.md) — repo map, priorities, agent workflow, security model
2. [`01-shared.md`](.agents/rules/01-shared.md) — Makefile, packages, DRY, docs, comments, typing, tests
3. [`02-frontend.md`](.agents/rules/02-frontend.md) — `client-web`: naming, FSD structure, Shadcn/theming, i18n + RTL, React Query, toasts, forms
4. [`03-backend.md`](.agents/rules/03-backend.md) — `backend`: TDD, structure, logger, RBAC tiers, Swagger, BadgerDB, response format

## Non-negotiables (summary)

- Never start dev servers yourself; verify with `make test`, `make lint`, `make front/typecheck`, `make front/lint`, `make front/test`.
- TDD. Backend tests go in `backend/tests/`.
- Use `make` targets for commands (`make help`). Package manager is **pnpm** only — no npm/npx/yarn.
- No mock data; if an endpoint is missing, say so and stop.
- Backend: `internal/logger` only (no `fmt.Print`/`log.Print`); every route wrapped in `protect`/`protectMember` unless explicitly public; every handler has a full Swagger block with an `**Access:**` line.
- Frontend: Shadcn + theme tokens only, lucide icons, no hard-coded strings (en/fa/ar JSON), logical Tailwind classes (`ms/me/ps/pe/start/end`), React Query hooks over `<domain>.api.ts`, zod forms with `*` on required labels, `unknown` not `any`.
- Web client + backend first; Wails desktop only when asked.

Edit the rules in `.agents/rules/` — the other agent config files only point there.
