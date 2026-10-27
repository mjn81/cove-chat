---
title: Website, roadmap and translations
description: How to edit the roadmap and translate this site.
---

The site lives in `website/` (Astro and Starlight). Run it with `make site/dev` and build it with `make site/build`.

## Editing the roadmap

Everything on the landing page and the roadmap page comes from one file: `website/src/data/roadmap.yaml`.

```yaml
- id: markdown            # unique, lowercase, used for translations
  area: chat              # calls privacy admin clients chat i18n platform security files ops
  title: Markdown and link rendering
  note: Custom renderer with link highlighting.
```

- **Shipped something?** Cut the block and paste it under the `shipped` phase.
- **Started something?** Move it under `now`.
- **New idea?** Copy any block under the right phase and give it a new `id`.
- A phase decides the status (`shipped` is done, `now` is in progress, the rest are planned). Override one item by adding `status: done | progress | planned`.
- Progress bars are computed from the items, so there are no percentages to maintain.

Commit the change. The deploy workflow rebuilds the site.

## Translating the site

The landing, download and roadmap pages are available in English, Persian and Arabic.

| File | Holds |
|---|---|
| `website/src/i18n/en.ts` | Every landing string. The source of truth |
| `website/src/i18n/fa.ts`, `ar.ts` | Translations. TypeScript fails the build if a key is missing |
| `website/src/data/roadmap.fa.yaml`, `roadmap.ar.yaml` | Roadmap translations keyed by item `id`. Missing ids fall back to English |

Documentation pages are English first. Persian and Arabic URLs (`/fa/docs/...`, `/ar/docs/...`) show the English page with a notice until a translation exists. To translate a page, copy it to `website/src/content/docs/fa/docs/<same path>` (or `ar/`) and translate the text.
