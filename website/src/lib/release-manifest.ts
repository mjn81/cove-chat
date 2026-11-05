/**
 * Builds the update manifest that native clients and servers read (https://covechat.dev/releases/manifest.json).
 * The format is documented in docs/auto-update.md; the Go reader is backend/pkg/update/manifest.go and the Android
 * reader is client-android .../update/UpdateManifest.kt, so change all three together.
 */

export interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GhAsset[];
}

export interface ManifestAsset {
  url: string;
  sha256: string;
  size: number;
}

export interface Manifest {
  channel: 'stable' | 'beta';
  version: string;
  released_at: string;
  notes: string;
  release_url: string;
  min_version?: string;
  assets: Record<string, ManifestAsset>;
}

/** Release file name -> manifest platform key. Mirrors AssetNameForKey in the Go library. */
const KEY_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^cove-(server-(?:linux|darwin|windows)-(?:amd64|arm64))\.zip$/, (m) => m[1]],
  [/^cove-desktop-windows-amd64\.zip$/, () => 'windows-amd64'],
  [/^cove-desktop-linux-amd64\.zip$/, () => 'linux-amd64'],
  [/^cove-desktop-mac-universal\.zip$/, () => 'darwin-universal'],
  [/^cove-android-.+\.apk$/, () => 'android'],
];

/** Maps a release file name to its manifest key, or null for files the manifest does not describe. */
export function manifestKey(fileName: string): string | null {
  for (const [re, key] of KEY_PATTERNS) {
    const m = fileName.match(re);
    if (m) return key(m);
  }
  return null;
}

/** Parses `sha256sum` output into file name -> lower-case digest. */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) out.set(m[2].trim(), m[1].toLowerCase());
  }
  return out;
}

type Triple = [number, number, number, string[]];

function parseSemver(v: string): Triple | null {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? m[4].split('.') : []] : null;
}

/** Semver precedence: negative when a < b. Unparseable versions sort lowest. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  const [px, py] = [x[3], y[3]];
  if (!px.length || !py.length) return px.length === py.length ? 0 : px.length ? -1 : 1;
  for (let i = 0; i < Math.min(px.length, py.length); i++) {
    if (px[i] === py[i]) continue;
    const [nx, ny] = [Number(px[i]), Number(py[i])];
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx < ny ? -1 : 1;
    if (!Number.isNaN(nx)) return -1;
    if (!Number.isNaN(ny)) return 1;
    return px[i] < py[i] ? -1 : 1;
  }
  return px.length === py.length ? 0 : px.length < py.length ? -1 : 1;
}

/** The highest-semver published release (pre-releases included: every 0.x release is one). */
export function newestRelease(releases: GhRelease[]): GhRelease | null {
  let best: GhRelease | null = null;
  for (const r of releases) {
    if (r.draft || !parseSemver(r.tag_name)) continue;
    if (!best || compareSemver(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best;
}

/**
 * Builds a manifest from a release and its SHA256SUMS text. Files without a checksum are left out, so a client can
 * never be pointed at an unverifiable download. Returns null when nothing in the release is verifiable.
 */
export function buildManifest(release: GhRelease, sumsText: string): Manifest | null {
  const sums = parseSums(sumsText);
  const assets: Record<string, ManifestAsset> = {};
  for (const a of release.assets) {
    const key = manifestKey(a.name);
    const sha256 = sums.get(a.name);
    if (key && sha256) assets[key] = { url: a.browser_download_url, sha256, size: a.size };
  }
  if (Object.keys(assets).length === 0) return null;
  const version = release.tag_name.replace(/^v/, '');
  const pre = release.prerelease || version.includes('-');
  return {
    channel: pre ? 'beta' : 'stable',
    version,
    released_at: release.published_at ?? new Date(0).toISOString(),
    notes: (release.body ?? '').trim(),
    release_url: release.html_url,
    assets,
  };
}
