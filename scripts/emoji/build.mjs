// Builds the emoji styles and the two default sticker packs that the server embeds
// (backend/internal/packs/assets). Run through `make emoji/build`.
//
// Output (all deterministic for the same upstream commits):
//   emoji/<style>/sheet.webp   one WebP sprite sheet, 64 px cells
//   emoji/<style>/index.json   {"size","width","height","emoji":{"<code points>":[x,y]}}
//   stickers/cove-basics/*.webp   static Fluent 3D stickers, 512 px
//   stickers/cove-moves/*.webp    animated Noto emoji, 256 px
//   licenses/*.txt, ATTRIBUTION.md, manifest.json
//
// Requires: git and network access (upstream repos are sparse-cloned into .cache/), Node 20+ and `pnpm install`
// in this folder (sharp, which bundles libwebp and librsvg: no ffmpeg/cwebp/ImageMagick needed).
//
// Flags: --out <dir>  --src <dir>  --only noto,twemoji,...,stickers,animated  --quality <n>  --no-fetch
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const OUT = path.resolve(args.out ?? path.join(here, '../../backend/internal/packs/assets'))
const SRC = path.resolve(args.src ?? path.join(here, '.cache/src'))
const QUALITY = Number(args.quality ?? 72)
const ONLY = args.only ? new Set(String(args.only).split(',')) : null
const CELL = 64
const COLS = 64
const STICKER_PX = 512
const ANIM_PX = 256
const ANIM_BUDGET = 150 * 1024

const REPOS = {
  noto: { url: 'https://github.com/googlefonts/noto-emoji.git', paths: ['/2D/png/128/', '/2D/svg/LICENSE'] },
  twemoji: { url: 'https://github.com/jdecked/twemoji.git', paths: ['/assets/72x72/', '/LICENSE-GRAPHICS'] },
  blobmoji: { url: 'https://github.com/C1710/blobmoji.git', paths: ['/svg/', '/LICENSE'] },
  fluent: {
    url: 'https://github.com/microsoft/fluentui-emoji.git',
    // Flat for the styles; the 3D art only for the stickers we ship (basics.json), not the whole 3D set.
    paths: ['/assets/*/Flat/*', '/assets/*/Default/Flat/*', '/assets/*/metadata.json', '/LICENSE'],
  },
  fxemoji: { url: 'https://github.com/mozilla/fxemoji.git', paths: ['/svgs/FirefoxEmoji/', '/LICENSE.md'] },
}

const basics = JSON.parse(fs.readFileSync(path.join(here, 'basics.json'), 'utf8'))
const animated = JSON.parse(fs.readFileSync(path.join(here, 'animated.json'), 'utf8'))
for (const b of basics) REPOS.fluent.paths.push('/' + b.path.replace(/\/[^/]*$/, '/'))

/** Style definitions: how to list a source's images as [key, file] pairs. */
const STYLES = [
  {
    id: 'noto',
    name: 'Noto Color Emoji',
    repo: 'noto',
    license: 'Apache-2.0',
    licenseFile: '2D/svg/LICENSE',
    credit: 'Noto Color Emoji © Google LLC, Apache License 2.0.',
    homepage: 'https://github.com/googlefonts/noto-emoji',
    list: (d) => listDir(path.join(d, '2D/png/128'), /^emoji_u([0-9a-f_]+)\.png$/, (m) => m[1].replaceAll('_', '-')),
  },
  {
    id: 'twemoji',
    name: 'Twemoji',
    repo: 'twemoji',
    license: 'CC-BY-4.0',
    licenseFile: 'LICENSE-GRAPHICS',
    credit: 'Twemoji graphics © Twitter, Inc. and other contributors (jdecked/twemoji fork), licensed CC BY 4.0.',
    homepage: 'https://github.com/jdecked/twemoji',
    list: (d) => listDir(path.join(d, 'assets/72x72'), /^([0-9a-f-]+)\.png$/, (m) => m[1]),
  },
  {
    id: 'blobmoji',
    name: 'Blobmoji',
    repo: 'blobmoji',
    license: 'Apache-2.0',
    licenseFile: 'LICENSE',
    credit: 'Blobmoji © Google LLC and the Blobmoji contributors (C1710/blobmoji, archived), Apache License 2.0.',
    homepage: 'https://github.com/C1710/blobmoji',
    list: (d) => listDir(path.join(d, 'svg'), /^emoji_u([0-9a-f_]+)\.svg$/, (m) => m[1].replaceAll('_', '-')),
  },
  {
    id: 'fluent',
    name: 'Fluent Emoji Flat',
    repo: 'fluent',
    license: 'MIT',
    licenseFile: 'LICENSE',
    credit: 'Fluent Emoji (Flat) © Microsoft Corporation, MIT License.',
    homepage: 'https://github.com/microsoft/fluentui-emoji',
    list: listFluentFlat,
  },
  {
    id: 'fxemoji',
    name: 'FxEmojis',
    repo: 'fxemoji',
    license: 'CC-BY-4.0',
    licenseFile: 'LICENSE.md',
    credit: 'FxEmojis © Mozilla Foundation, graphics licensed CC BY 4.0.',
    homepage: 'https://github.com/mozilla/fxemoji',
    list: (d) =>
      listDir(path.join(d, 'svgs/FirefoxEmoji'), /^u([0-9A-F]+(?:-[0-9A-F]+)*)(?:-[a-z][a-z0-9]*)?\.svg$/, (m) => m[1].toLowerCase()),
  },
]

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const manifestPath = path.join(OUT, 'manifest.json')
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { schema: 1, emoji_styles: [], sticker_packs: [], animated_emoji: [] }
  const want = (id) => !ONLY || ONLY.has(id)

  if (!args['no-fetch']) fetchSources(STYLES.filter((s) => want(s.id)).map((s) => s.repo).concat(want('stickers') ? ['fluent'] : []))

  fs.mkdirSync(path.join(OUT, 'licenses'), { recursive: true })
  for (const style of STYLES) {
    if (!want(style.id)) continue
    const entry = await buildStyle(style)
    manifest.emoji_styles = [...manifest.emoji_styles.filter((s) => s.id !== style.id), entry]
  }
  if (want('stickers')) {
    const pack = await buildBasics()
    manifest.sticker_packs = [...manifest.sticker_packs.filter((p) => p.id !== pack.id), pack]
  }
  if (want('animated')) {
    const { pack, table } = await buildMoves()
    manifest.sticker_packs = [...manifest.sticker_packs.filter((p) => p.id !== pack.id), pack]
    manifest.animated_emoji = table
  }

  const order = STYLES.map((s) => s.id)
  manifest.emoji_styles.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  manifest.sticker_packs.sort((a, b) => a.order - b.order)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n')
  fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.md'), attribution(manifest))
  report(manifest)
}

// ---- sources ------------------------------------------------------------------------------------------------- //

function fetchSources(repoIds) {
  for (const id of new Set(repoIds)) {
    const dir = path.join(SRC, id)
    const r = REPOS[id]
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.mkdirSync(SRC, { recursive: true })
      git(SRC, ['clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', r.url, id])
    }
    git(dir, ['sparse-checkout', 'set', '--no-cone', ...r.paths])
    git(dir, ['checkout', '-q'])
  }
}

function git(cwd, argv) {
  execFileSync('git', argv, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
}

function commitOf(repo) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(SRC, repo) }).toString().trim()
}

function listDir(dir, re, keyOf) {
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    const m = re.exec(name)
    if (m) out.push([normalizeKey(keyOf(m)), path.join(dir, name)])
  }
  return out
}

/** Fluent keeps one folder per emoji with a metadata.json (its code points) and a Flat svg, sometimes under Default/. */
function listFluentFlat(root) {
  const out = []
  const assets = path.join(root, 'assets')
  for (const name of fs.readdirSync(assets).sort()) {
    const meta = path.join(assets, name, 'metadata.json')
    if (!fs.existsSync(meta)) continue
    const { unicode } = JSON.parse(fs.readFileSync(meta, 'utf8'))
    if (!unicode) continue
    for (const sub of ['Flat', path.join('Default', 'Flat')]) {
      const dir = path.join(assets, name, sub)
      if (!fs.existsSync(dir)) continue
      const svg = fs.readdirSync(dir).find((f) => f.endsWith('.svg'))
      if (svg) {
        out.push([normalizeKey(String(unicode).trim().replaceAll(/\s+/g, '-')), path.join(dir, svg)])
        break
      }
    }
  }
  return out
}

/** Keys are lower-case hex code points joined by "-" with every FE0F removed, so styles that keep or drop it agree. */
function normalizeKey(raw) {
  return raw
    .toLowerCase()
    .split('-')
    .filter((cp) => cp !== 'fe0f' && cp !== '')
    .map((cp) => cp.replace(/^0+(?=[0-9a-f]{4})/, ''))
    .join('-')
}

// ---- emoji styles -------------------------------------------------------------------------------------------- //

async function buildStyle(style) {
  const root = path.join(SRC, style.repo)
  const seen = new Map()
  for (const [key, file] of style.list(root)) if (!seen.has(key)) seen.set(key, file)
  const keys = [...seen.keys()].sort()

  const cells = []
  const index = {}
  let i = 0
  for (const key of keys) {
    const buf = await rasterize(seen.get(key), CELL)
    if (!buf) continue
    const x = (i % COLS) * CELL
    const y = Math.floor(i / COLS) * CELL
    cells.push({ input: buf, raw: { width: CELL, height: CELL, channels: 4 }, left: x, top: y })
    index[key] = [x, y]
    i++
  }
  const rows = Math.ceil(i / COLS)
  const width = COLS * CELL
  const height = rows * CELL
  const sheet = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells)
    .webp({ quality: QUALITY, alphaQuality: 90, effort: 6, smartSubsample: true })
    .toBuffer()

  const dir = path.join(OUT, 'emoji', style.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'sheet.webp'), sheet)
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ size: CELL, width, height, emoji: index }))
  copyLicense(path.join(root, style.licenseFile), style.id)
  console.log(`${style.id}: ${i} emoji, sheet ${width}x${height}, ${(sheet.length / 1048576).toFixed(2)} MB`)
  return {
    id: style.id,
    name: style.name,
    license: style.license,
    license_file: `licenses/${style.id}.txt`,
    attribution: style.credit,
    source: style.homepage,
    source_commit: commitOf(style.repo),
    cell_size: CELL,
    width,
    height,
    count: i,
    sheet: `emoji/${style.id}/sheet.webp`,
    index: `emoji/${style.id}/index.json`,
  }
}

/** Renders a PNG or SVG into a CELL x CELL RGBA buffer (contain, transparent), crisp for vectors. */
async function rasterize(file, size) {
  try {
    let img
    if (file.endsWith('.svg')) {
      const svg = fs.readFileSync(file)
      const meta = await sharp(svg).metadata()
      const longest = Math.max(meta.width ?? size, meta.height ?? size)
      const density = Math.min(2400, Math.max(72, (72 * size * 2) / longest))
      img = sharp(svg, { density })
    } else {
      img = sharp(file)
    }
    return await img
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer()
  } catch (e) {
    console.warn(`skip ${path.basename(file)}: ${e.message}`)
    return null
  }
}

// ---- sticker packs ------------------------------------------------------------------------------------------- //

function slug(name) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
}

function emojiFor(codes) {
  // Two text-default characters need an explicit emoji presentation selector to show as the picture.
  const withVS = new Set([0x2764, 0x270c])
  return codes
    .map((c) => String.fromCodePoint(c) + (withVS.has(c) && codes.length === 1 ? '️' : ''))
    .join('')
}

async function buildBasics() {
  const root = path.join(SRC, 'fluent')
  const dir = path.join(OUT, 'stickers', 'cove-basics')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const items = []
  for (const b of basics) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets', b.name, 'metadata.json'), 'utf8'))
    const id = slug(b.name)
    const buf = await sharp(path.join(root, b.path))
      .resize(STICKER_PX, STICKER_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
      .webp({ quality: 82, alphaQuality: 90, effort: 6 })
      .toBuffer()
    fs.writeFileSync(path.join(dir, id + '.webp'), buf)
    items.push({ id, name: b.name, emoji: meta.glyph, file: `stickers/cove-basics/${id}.webp`, animated: false, bytes: buf.length })
  }
  copyLicense(path.join(root, 'LICENSE'), 'fluent-3d')
  const total = items.reduce((n, i) => n + i.bytes, 0)
  console.log(`cove-basics: ${items.length} stickers, ${(total / 1048576).toFixed(2)} MB`)
  return {
    id: 'cove-basics',
    name: 'Cove Basics',
    order: 0,
    animated: false,
    license: 'MIT',
    license_file: 'licenses/fluent-3d.txt',
    attribution: 'Fluent Emoji (3D) © Microsoft Corporation, MIT License. Converted to WebP.',
    source: 'https://github.com/microsoft/fluentui-emoji',
    source_commit: commitOf('fluent'),
    items,
  }
}

async function buildMoves() {
  const cache = path.join(SRC, '..', 'animated')
  fs.mkdirSync(cache, { recursive: true })
  const dir = path.join(OUT, 'stickers', 'cove-moves')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const items = []
  const table = []
  const seen = new Set()
  const over = []
  for (const a of animated) {
    if (seen.has(a.code)) continue // the preview listed one code point twice
    seen.add(a.code)
    const src = path.join(cache, a.code + '.webp')
    if (!fs.existsSync(src)) {
      fs.writeFileSync(src, await download(`https://fonts.gstatic.com/s/e/notoemoji/latest/${a.code}/512.webp`))
    }
    const best = await encodeAnimated(src)
    if (best.length > ANIM_BUDGET) over.push(`${a.code} ${(best.length / 1024).toFixed(0)} KB`)
    const id = slug(a.name)
    fs.writeFileSync(path.join(dir, id + '.webp'), best)
    const codes = a.code.split('_').map((h) => parseInt(h, 16))
    items.push({ id, name: a.name, emoji: emojiFor(codes), file: `stickers/cove-moves/${id}.webp`, animated: true, bytes: best.length })
    table.push({ sequence: normalizeKey(a.code.replaceAll('_', '-')), id })
  }
  const license = fs.readFileSync(path.join(SRC, 'twemoji', 'LICENSE-GRAPHICS'), 'utf8')
  fs.writeFileSync(
    path.join(OUT, 'licenses', 'noto-animated.txt'),
    'Noto Emoji animations © Google LLC, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).\n' +
      'Source: https://googlefonts.github.io/noto-emoji-animation/ (re-encoded to 256 px animated WebP).\n\n' +
      license,
  )
  const total = items.reduce((n, i) => n + i.bytes, 0)
  console.log(`cove-moves: ${items.length} animations, ${(total / 1048576).toFixed(2)} MB; over budget: ${over.join(', ') || 'none'}`)
  return {
    pack: {
      id: 'cove-moves',
      name: 'Cove Moves',
      order: 1,
      animated: true,
      license: 'CC-BY-4.0',
      license_file: 'licenses/noto-animated.txt',
      attribution: 'Noto Emoji animations © Google LLC, licensed CC BY 4.0. Re-encoded to 256 px animated WebP.',
      source: 'https://googlefonts.github.io/noto-emoji-animation/',
      items,
    },
    table,
  }
}

/**
 * Re-encodes a 512 px animated WebP as a 256 px one under ANIM_BUDGET. The upstream animations run at about 33 fps, so
 * most of the size is frame count: keep every step-th frame (folding the dropped frames' time into the kept one, so the
 * speed stays the same) and lower the quality only as far as needed. The first combination under budget wins; if none
 * fits, the smallest is used and reported.
 */
async function encodeAnimated(src) {
  const meta = await sharp(src, { animated: true }).metadata()
  const pages = meta.pages ?? 1
  const delays = meta.delay ?? Array(pages).fill(40)
  const frames = []
  for (let i = 0; i < pages; i++) {
    frames.push(
      await sharp(src, { page: i, pages: 1 })
        .resize(ANIM_PX, ANIM_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .png()
        .toBuffer(),
    )
  }
  let smallest = null
  for (const [step, quality] of [[2, 62], [2, 48], [3, 56], [3, 42], [4, 42], [4, 30]]) {
    const picked = []
    const delay = []
    for (let i = 0; i < pages; i += step) {
      picked.push(frames[i])
      let d = 0
      for (let j = i; j < Math.min(pages, i + step); j++) d += delays[j]
      delay.push(d)
    }
    const buf = await sharp(picked, { join: { animated: true } })
      .webp({ quality, alphaQuality: 50, effort: 6, minSize: true, loop: 0, delay })
      .toBuffer()
    if (!smallest || buf.length < smallest.length) smallest = buf
    if (buf.length <= ANIM_BUDGET) return buf
  }
  return smallest
}

// ---- output helpers ------------------------------------------------------------------------------------------ //

/** Downloads a URL with a timeout and a few retries (the font CDN times out now and then). */
async function download(url, attempts = 5) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 1000 * i))
    }
  }
  throw new Error(`download ${url}: ${last}`)
}

function copyLicense(from, id) {
  fs.copyFileSync(from, path.join(OUT, 'licenses', id + '.txt'))
}

function attribution(m) {
  const lines = ['# Attribution', '', 'Generated by `make emoji/build` (scripts/emoji/build.mjs). Do not edit by hand.', '', '## Emoji styles', '']
  for (const s of m.emoji_styles) {
    lines.push(`- **${s.name}** (${s.license}): ${s.attribution} Source: ${s.source} @ ${s.source_commit.slice(0, 12)}. Licence text: ${s.license_file}.`)
  }
  lines.push('', '## Sticker packs and animated emoji', '')
  for (const p of m.sticker_packs) {
    lines.push(`- **${p.name}** (${p.license}): ${p.attribution} Source: ${p.source}${p.source_commit ? ' @ ' + p.source_commit.slice(0, 12) : ''}. Licence text: ${p.license_file}.`)
  }
  lines.push('', 'The animated emoji table (big single-emoji display) reuses the Cove Moves animations.', '')
  return lines.join('\n')
}

function report(m) {
  let total = 0
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) walk(p)
      else total += fs.statSync(p).size
    }
  }
  walk(OUT)
  const sha = createHash('sha256').update(JSON.stringify(m)).digest('hex').slice(0, 12)
  console.log(`assets total ${(total / 1048576).toFixed(2)} MB, manifest ${sha}`)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const k = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[k] = true
    else {
      out[k] = next
      i++
    }
  }
  return out
}
