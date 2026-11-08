# `.covetheme` format, version 1

A theme file is **data only**: colours and backgrounds. It never contains CSS, JavaScript, HTML, SVG or fonts, and a
theme can never change behaviour. The web reference implementation is `client-web/src/domains/themes/`
(`utils/covetheme.ts` parser, `utils/zip-reader.ts` archive hardening, `utils/tokens.ts` allow-list and contrast
guard). Android and a server-side validator (gallery uploads) must implement the same rules.

- Extension `.covetheme`, MIME type `application/vnd.cove.theme+zip`.
- A ZIP archive (stored or deflate) holding `theme.json` and an optional `assets/` folder (one level, no sub-folders).

## `theme.json`

| Key | Type | Rules |
|---|---|---|
| `format` | string | exactly `"cove-theme"` |
| `version` | integer | `1`. Higher is refused (`unsupported_version`) |
| `id` | string | 3-64 chars, `^[a-z0-9]+([._-][a-z0-9]+)*$`. Built-in ids (`cove`, `nord`, ...) are reserved |
| `name` | object | `en` required, `fa` / `ar` optional; each 1-40 chars, no control or bidi-override characters |
| `author` | string, optional | up to 60 chars |
| `license` | string, optional | up to 40 chars |
| `base` | `"dark"` or `"light"` | the mode `tokens` is written for |
| `tokens` | object | token name to colour; the 19 core tokens are required |
| `light` | object, optional | only for `base: "dark"`: the colours used in light mode |
| `chat` | object, optional | `background` and `bubble_tint`, below |
| `preview` | string, optional | path of an image in `assets/` |

Unknown keys, at any level, are **dropped with a warning**, never applied.

### Tokens

Allow-listed names only (the CSS variables in `client-web/src/index.css`):

- Core (required): `background foreground card card-foreground popover popover-foreground primary primary-foreground secondary secondary-foreground muted muted-foreground accent accent-foreground destructive destructive-foreground border input ring`
- Optional (default to the Cove value of the same mode): `mention-background mention-foreground mention-border success success-foreground warning warning-foreground overlay overlay-foreground`

A value is either an HSL triplet `H S% L%` (decimals up to two places; hue 0-360, saturation and lightness 0-100,
out-of-range values are **clamped** with a warning) or a strict hex colour (`#rgb`, `#rrggbb`, no alpha). Anything else
(named colours, `rgb()`, `var()`, `url()`, trailing text) is an error. Values are normalised to the triplet form.

**Readability guard.** For each text/surface pair (`foreground`/`background`, `card-foreground`/`card`,
`popover-foreground`/`popover`, `primary-foreground`/`primary`, `secondary-foreground`/`secondary`,
`muted-foreground`/`background` and `/muted`, `accent-foreground`/`accent`, `destructive-foreground`/`destructive`) the
WCAG contrast ratio must be at least **3:1** (below it the file is refused, `low_contrast`); between 3 and 4.5 it is
accepted with a warning. A flat or gradient chat background must also keep 3:1 against `foreground` (both variants).

### `chat`

```json
{
  "background": { "type": "pattern", "pattern": "space" },
  "bubble_tint": { "color": "#336699", "strength": 0.2 }
}
```

`background.type`:

- `none`
- `pattern` with `pattern` one of `animals space games sweets travel nature food music tech weather`
- `color` with `color`
- `gradient` with `from`, `to`, `angle` (0-360, default 180)
- `image` with `asset` (a path in `assets/`), `opacity` (0-1, default 1), `blur` (0-20 px, default 0), `fit` (`cover` | `contain` | `tile`, default `cover`)

`bubble_tint.strength` is clamped to 0-1.

## Archive rules

- At most 20 entries; archive at most 10 MB; `theme.json` at most 64 KB.
- Names: relative, `/` separators, no `..`, `.` or empty segments, no leading `/`, no drive letters, no backslashes, no
  control characters, at most 200 bytes, no duplicates (case-insensitive). Violations refuse the whole file.
- No symlinks, no encrypted entries, no ZIP64, no multi-disk archives, only stored and deflate. Entries must not overlap.
  Declared sizes are enforced (inflate into a buffer of the declared size) and each entry is CRC-checked.
- Expanded size per entry at most 4 MB, total at most 20 MB; expanded/compressed ratio at most 100 for entries over 64 KB.
- Only `theme.json` and `assets/<name>.(png|jpg|jpeg|webp)` are read; names match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
  Other entries are ignored with a warning (never read).
- Images: PNG, JPEG or WebP, **identified by magic bytes** and matching the file extension; at most 4096 x 4096 px
  (read from the header), at most 2 MB each and 8 MB in total. Nested archives, SVG, GIF and anything else are refused.
  Clients additionally decode each image with the platform decoder (`createImageBitmap` on the web) and refuse on failure.
- Images unreferenced by `chat.background` or `preview` are dropped with a warning.

Images are only ever shown through `blob:` URLs created from the stored bytes; a theme cannot reference a network URL.
