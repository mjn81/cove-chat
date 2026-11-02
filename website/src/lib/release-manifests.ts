import { REPO } from './site';
import { buildManifest, newestRelease, type GhRelease, type Manifest } from './release-manifest';

const API = `https://api.github.com/repos/${REPO}`;

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function fetchReleases(): Promise<GhRelease[]> {
  try {
    const res = await fetch(`${API}/releases?per_page=10`, { headers: headers(), signal: AbortSignal.timeout(10000) });
    return res.ok ? ((await res.json()) as GhRelease[]) : [];
  } catch {
    // An offline build must not fail; the endpoints then publish an error document that clients treat as "no manifest".
    return [];
  }
}

async function fetchSums(release: GhRelease): Promise<string> {
  const asset = release.assets.find((a) => a.name === 'SHA256SUMS');
  if (!asset) return '';
  try {
    const res = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

export interface ManifestSet {
  /** Manifest for the highest-semver release, or null when none could be built. */
  latest: Manifest | null;
  /** Every manifest built from the recent releases, newest first (one file per version). */
  all: Manifest[];
}

let cached: Promise<ManifestSet> | null = null;

/**
 * Builds manifests for the recent GitHub releases at site-build time. The release workflow starts a site rebuild
 * after publishing, so `/releases/manifest.json` always describes the newest release.
 */
export function getManifests(): Promise<ManifestSet> {
  cached ??= (async () => {
    const releases = (await fetchReleases()).filter((r) => !r.draft);
    const built: Manifest[] = [];
    for (const r of releases) {
      const m = buildManifest(r, await fetchSums(r));
      if (m) built.push(m);
    }
    const newest = newestRelease(releases);
    const latest = newest ? (built.find((m) => `v${m.version}` === newest.tag_name) ?? null) : null;
    return { latest, all: built };
  })();
  return cached;
}
