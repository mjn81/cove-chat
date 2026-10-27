# Contributing to Cove

Thanks for helping. The full guide lives in the docs: **Contributing > Development setup** and **Testing and standards** (`website/src/content/docs/docs/contributing/`).

## Quick version

1. Fork and clone, then `make front/install`.
2. Use `make` targets (`make help`) for builds, tests and linting.
3. Backend changes start with a failing test in `backend/tests/`. Every route needs auth, and handlers need Swagger annotations (`make swagger`).
4. Web client changes use Shadcn, theme tokens, lucide icons, i18n keys in `en.json`, `fa.json` and `ar.json`, and logical (RTL-safe) Tailwind classes.
5. Before opening a pull request run: `make test`, `make lint`, `make front/typecheck`, `make front/lint`, `make front/test`.

Look for issues labelled `good first issue`. For larger changes open an issue or discussion first.

By contributing you agree your work is licensed under the MIT license.
