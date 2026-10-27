# Cove landing + docs site - plan

Goal: one public website for Cove that (1) sells the project, (2) lets people download server / client builds
and reach GitHub, (3) shows features and the roadmap, and (4) hosts complete self-hosting documentation in the
style of Supabase / Next.js docs. Visual mockup: [`landing-mockup.html`](./landing-mockup.html) (open in a browser).

## 1. Decisions to confirm

| # | Question | Recommendation |
|---|---|---|
| 1 | Where does the site live? | New top-level `website/` package (own `package.json`), **not** inside `client-web/`. It is a static, SEO-facing site; the app is an authenticated SPA. |
| 2 | Framework | **Astro 5 + Starlight** for `/docs`, React islands for animated landing sections. Zero JS by default, built-in search (Pagefind), i18n, sidebar, MDX, dark/light. Alternative: Next.js + Fumadocs (heavier, more flexible). |
| 3 | Hosting | GitHub Pages (free, same repo, deploy via Actions) or Cloudflare Pages. Custom domain later. |
| 4 | Download source | GitHub Releases API fetched **at build time** (rebuild on `release: published`), with a client-side fallback to the "latest" redirect links. No backend needed. |
| 5 | Languages | EN first; structure for FA/AR from day one (same i18n story as the app, RTL via logical classes). Translate after launch. |
| 6 | Domain / repo URL | Repo is `github.com/mjn81/nodetalk`. Need the final public name/URL (the repo still says `nodetalk`). Also: is there a Discord / Matrix community link? |
| 7 | Android / iOS | Android APK from Releases only for now. iOS shown as "roadmap". |
| 8 | Roadmap source of truth | Keep `TODO.md` and generate `roadmap.json` from it, or replace `TODO.md` with the JSON. Recommend the JSON (structured, reusable on site). |

## 2. Brand and design system (reused from `client-web`)

Tokens are copied from `client-web/src/index.css` so the site and the app feel like one product.

| Token | Dark | Light |
|---|---|---|
| background | `#23201F` | `#FFFFFF` |
| card / muted | `#2E2A29` | `#F8F4F0` |
| accent (hover) | `#3B3735` | `#EFE8E1` |
| border | `#46413E` | `#E8DFD6` |
| foreground | `#E8E5E3` | `#201A16` |
| **primary** (terracotta) | `#D9826A` | `#C4624A` |
| success / warning / destructive | `#58C48A` / `#F5C265` / `#F0616D` | `#2E9A55` / `#8A5A00` / `#D63A3A` |

- Logo: `branding/cove-mark.svg` / `cove-icon.svg`. Name from one `brand.ts` constant, never hard-coded.
- Type: Inter (UI), JetBrains Mono (code/terminal), Vazirmatn for FA/AR.
- Shape: radius 0.5rem-1rem, 1px borders over shadows, warm neutrals. The app is "flat Discord-like"; the site
  is the same language with more air plus a few tasteful effects (below).
- Light + dark both first-class, default to system, toggle in nav. RTL-safe logical Tailwind classes.

### Component inspiration (re-implemented with our tokens, not copied wholesale)

| Effect | Source style | Used for |
|---|---|---|
| Animated grid / dot background + radial terracotta glow | Magic UI "Grid Pattern", "Retro Grid" | Hero |
| Border beam / shine border | Magic UI "Border Beam" | Primary CTA, featured download card |
| Bento grid with hover spotlight | Magic UI "Bento Grid", Cult UI | Features |
| Animated beam between nodes | Magic UI "Animated Beam" | "How it works" (client -> server -> client), federation |
| Terminal with typing animation + copy | Magic UI "Terminal" | Quick start |
| Marquee | Magic UI "Marquee" | Tech stack strip |
| Number ticker | Magic UI "Number Ticker" | Stats (stars, downloads, languages) |
| Animated tabs / pill nav / dock | Cult UI, Kokonut UI | OS switcher, docs tabs |
| Text reveal / gradient text | Kokonut UI | Headlines |
| Scroll-linked timeline | Kokonut UI | Roadmap |

Motion rules: `framer-motion` / CSS only, 150-600ms, ease-out, `prefers-reduced-motion` disables everything
non-essential, no layout shift, animate transform/opacity only, pause offscreen (IntersectionObserver).

## 3. Site map

```
/                    Landing
/download            Server + clients, all OS, checksums, Docker, "verify your download"
/features            Full feature matrix (current + planned)
/roadmap             Phased roadmap, status chips, filter by area
/docs/...            Documentation (see §5)
/blog  (later)       Release notes / changelog from GitHub Releases
/security            Security model, threat model, responsible disclosure
/community           GitHub, issues, discussions, contributing, code of conduct
/about  (footer)     License, credits
```

### Landing page sections (top to bottom)

1. **Nav** - logo, Features, Docs, Roadmap, Download, GitHub stars pill, theme toggle, language switcher.
2. **Hero** - headline ("Your community. Your server. Your keys."), sub, CTAs (Get started / Download / GitHub),
   animated product shot (chat window with live typing, voice call tile, presence), trust badges (Open source,
   Self-hosted, AES-256-GCM, Go + React).
3. **Stack/platform marquee** - Go, BadgerDB, WebRTC, React, Android, Wails, Docker.
4. **Features bento** - 6-8 cards, each with a micro-animation (see §4).
5. **How it works** - animated beam diagram: client encrypts -> server routes ciphertext -> members decrypt;
   explains server-trusted model honestly (and Whisper as the zero-persistence exception).
6. **Self-host in 60 seconds** - tabbed terminal (Docker / Binary / Source) with copy buttons.
7. **Downloads** - OS-detected primary button, grid of Server + Web/Desktop + Android builds.
8. **Roadmap preview** - 3 columns Now / Next / Later with status chips, link to `/roadmap`.
9. **Open-source section** - GitHub stats ticker, contributors avatars, license, "Good first issues".
10. **FAQ** - accordion (Is it E2EE? How do I back up? Federation? Hardware needs? License?).
11. **Final CTA + footer** - links, license, version, status.

## 4. Feature inventory (what the site must claim - all verified against the repo)

**Shipped today**
- Server-trusted encryption: AES-256-GCM messages, Argon2id KEK, DEK-encrypted BadgerDB, per-channel keys
- Real-time messaging over WebSocket, presence, typing, replies / forward, emoji picker, voice notes
- Files and media upload/download with size limits; video messages (ffmpeg transcoding)
- Group audio/video calls and screen sharing - in-process **WebRTC SFU** (Pion), DTLS-SRTP, embedded STUN/TURN
- Air-gapped mode: raw UDP audio router for isolated LANs
- **Whisper** zero-persistence E2EE chats
- Friends / DMs / channels / roles (member, admin, owner) with RBAC on every route
- Server admin panel: registration modes, invites, config editor, audit log, backup (in progress on this branch)
- Clients: Web (React 19), Desktop (Wails - Windows/macOS/Linux), Android (Compose, calls, Whisper)
- i18n: English, Persian, Arabic (RTL)
- Self-hosting: single Go binary or Docker, one `config.toml`, Swagger/OpenAPI at `/api/docs`
- Security hygiene: httpOnly session cookie + CSRF, rate limiting, no secrets in logs

**Roadmap (from `TODO.md`, regrouped for users)**

| Phase | Theme | Items |
|---|---|---|
| Now | Stability + polish | UI perf, full FA translations, markdown + link rendering, text selection / copy, network-quality indicator, file-type icons |
| Next | Privacy | Security tab (DM / group privacy), secure link previews via caching proxy, Whisper permissions |
| Next | Media | Noise suppression / AGC controls, Opus over UDP, VAD, native video player |
| Later | Platforms | PWA, iOS client |
| Later | Ecosystem | Plugin architecture, sticker packs, S3-compatible storage, update checks, opt-in telemetry |
| Future | Federation | Server-to-server protocol, cross-server messaging, global identity routing |

Roadmap data lives in one `roadmap.json` (id, phase, status, area, title, description, issue link) so the
landing preview, `/roadmap`, and docs reuse it. Seed it from `TODO.md`; keep `TODO.md` as source of truth or
replace it with the JSON (decision #8).

## 5. Documentation structure (Starlight)

```
Getting started
  Introduction            what Cove is, who it is for, trust model in one page
  Quick start             Docker in 5 minutes; first account becomes Owner
  Architecture            diagram: clients, API, WS hub, SFU, BadgerDB, storage
Self-hosting
  Requirements            CPU/RAM/disk, ports (4000/tcp, 9090/udp, TURN range), ffmpeg
  Docker & Compose        dev vs production compose, volumes, env vars, upgrades
  Binary install          download, systemd unit, Windows service, macOS launchd
  Build from source       Go 1.25 + pnpm; Makefile targets
  Reverse proxy & TLS     Caddy, nginx, Traefik, Cloudflare; WebSocket + CORS notes
  Backups & restore       DB, uploads, master password (what happens if lost)
  Upgrading               versioning, migrations, rollback
Configuration
  config.toml reference   every key: type, default, restart-required (generated from config schema)
  Environment variables
  Voice & calls           WebRTC vs raw UDP, TURN, firewall/NAT, public IP
  Storage                 local disk now, S3 (planned)
  Registration & invites  open / invite-only / closed
Administration
  Admin panel             roles, audit log, danger zone
  Roles & permissions     RBAC table
  Moderation
  Monitoring & logs
Security
  Encryption model        KEK/DEK/channel keys, what the server can and cannot see
  Whisper                 guarantees and limits
  Hardening checklist
  Reporting vulnerabilities
Clients
  Web, Desktop (Wails), Android - install, connect to a server, server-select step
API
  REST reference          embedded from `backend/docs/swagger.json` (Scalar or Redoc) - auto-generated
  WebSocket events
Contributing
  Dev setup, repo tour, testing (TDD rules), coding standards, translations, releasing (RELEASE_GUIDE.md)
Reference
  FAQ, Troubleshooting, Changelog, Glossary
```

Reuse and don't duplicate: `README.md`, `DOCKER.md`, `RELEASE_GUIDE.md`, `desktop_build_guide.md`,
`examples/`, `config.toml.example`, and `backend/docs/swagger.json` become the source for these pages
(migrate content, then replace the originals with links). The config reference and API reference are
**generated** in CI so docs cannot drift from the code.

Docs UX: left sidebar, right "on this page" TOC, Cmd-K search, copy buttons, tabbed code (Docker / Binary),
callouts (note / tip / warning / danger), "Edit this page on GitHub", prev/next, version badge, OS tabs persisted.

## 6. Open-source standard pages and repo files

- `LICENSE` (confirm license - none visible in repo root today), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue/PR templates, `CHANGELOG.md` (or GitHub Releases), `.github/workflows` for CI + release
- README badges (release, CI, license, stars, Docker pulls), screenshot/GIF, link to the site
- SEO: OpenGraph + Twitter card image (generated), sitemap, robots, JSON-LD `SoftwareApplication`, favicon set
  from `branding/`, canonical URLs, hreflang for FA/AR
- Analytics: none by default or privacy-friendly (Plausible / Umami self-hosted) - fits the product's stance
- Accessibility: WCAG AA contrast on both themes, keyboard nav, focus rings, skip link, reduced motion
- Performance budget: Lighthouse >= 95, LCP < 2s, landing JS < 150 KB gz, images AVIF/WebP, self-hosted fonts

## 7. Technical stack

| Concern | Choice |
|---|---|
| Framework | Astro 5 + Starlight, React 19 islands (`client:visible`) |
| Styling | Tailwind 3 (same `tailwind.config.js` token map as `client-web`), CSS variables |
| UI primitives | Shadcn-style components copied from `client-web` where sensible; Magic UI / Cult UI / Kokonut-style effects hand-built (they are copy-paste, MIT) |
| Animation | `motion` (framer-motion) + CSS keyframes; `lenis` optional smooth scroll |
| Icons | `lucide-react` + simple-icons for brands |
| Content | MDX docs, `roadmap.json`, `features.json`, GitHub API at build time |
| Search | Pagefind (static, offline) |
| API docs | Scalar from `swagger.json` |
| i18n | Astro i18n routing, `en` first, `fa` / `ar` later |
| Quality | `pnpm`, ESLint, `astro check`, Playwright smoke + link checker, Lighthouse CI |
| CI/CD | GitHub Actions: build on push, deploy Pages on `main`, rebuild on release |
| Makefile | `site/install`, `site/dev` (user runs), `site/build`, `site/lint`, `site/typecheck`, `site/gen` (config + API reference) |

Per project rules: the agent never starts dev servers; verification is build + typecheck + lint + link check.

## 8. Phases

| Phase | Output | Notes |
|---|---|---|
| 0 | Approve mockup + decisions in §1 | **You are here** |
| 1 | `website/` scaffold, tokens, layout, nav/footer, theme + i18n shell, CI | |
| 2 | Landing page sections + animations, roadmap/features JSON | |
| 3 | Download page (Releases API at build, OS detection, checksums) | needs a real release with assets |
| 4 | Docs: IA, quick start, self-hosting, config reference generation, API reference | largest chunk |
| 5 | Security, community, FAQ, SEO/OG images, a11y + perf pass | |
| 6 | Launch: domain, repo README refresh, release announcement | |

## 9. Risks and prerequisites

- **No published releases / CI exist yet** (no `.github/workflows`, builds are produced by `make release`). The
  download page needs a release workflow that attaches server zips, desktop zips, APK, Docker image tags and
  `SHA256SUMS`. This is a prerequisite for phase 3.
- The Docker image name (`<user>/nodetalk-server`) and registry must be decided and published.
- Product claims must stay honest: Cove is **server-trusted**, not end-to-end encrypted, except Whisper. The
  site says so plainly, in the hero sub-text and the security page.
- Technical identifiers still say `nodetalk` (repo, Docker, binary). The site should show Cove everywhere user-facing
  and be explicit where commands still use `nodetalk-server`.
- Desktop (Wails) sections only describe shipped behaviour; no desktop-only work is implied.
