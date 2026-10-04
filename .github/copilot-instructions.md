# Copilot Instructions — NodeTalk

The canonical development guidelines live in `.agents/rules/`. Follow them:

- `.agents/rules/00-project-overview.md` — repo map, agent workflow, security model
- `.agents/rules/01-shared.md` — Makefile, DRY, documentation, typing, tests
- `.agents/rules/02-frontend.md` — `client-web` (React/Vite/TS): naming, FSD layout, Shadcn + theme tokens, i18n (en/fa/ar) + logical RTL classes, React Query, toasts, zod forms
- `.agents/rules/03-backend.md` — `backend` (Go): TDD in `backend/tests/`, `internal/logger`, deny-by-default access tiers, Swagger with an `**Access:**` line on every handler, BadgerDB persistence, `ErrorResponse`/`StatusResponse` format

Key reminders: pnpm only (no npm/npx); use `make` targets; never start dev servers; no mock data; no hard-coded UI strings or colors; `unknown` instead of `any`.
