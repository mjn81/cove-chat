import { REPO } from './site';

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
}

export interface ReleaseInfo {
  /** Tag such as `v0.9.0`, or null when no release is published yet. */
  tag: string | null;
  assets: ReleaseAsset[];
  stars: number | null;
}

const API = `https://api.github.com/repos/${REPO}`;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    // Offline builds and rate limits must never break the site; the UI falls back to the "latest" links.
    return null;
  }
}

/**
 * Fetches the latest release and star count at build time. Rebuild the site on `release: published`
 * to refresh it. Returns empty data (not an error) when GitHub is unreachable or no release exists.
 */
let cached: Promise<ReleaseInfo> | null = null;
export function getReleaseInfo(): Promise<ReleaseInfo> {
  cached ??= fetchReleaseInfo();
  return cached;
}

async function fetchReleaseInfo(): Promise<ReleaseInfo> {
  const [release, repo] = await Promise.all([
    // /releases/latest skips pre-releases, and every 0.x release is a pre-release, so read the list instead.
    getJson<{ tag_name: string; draft: boolean; assets: { name: string; size: number; browser_download_url: string }[] }[]>('/releases?per_page=10'),
    getJson<{ stargazers_count: number }>(''),
  ]);
  const newest = release?.find((r) => !r.draft) ?? null;
  return {
    tag: newest?.tag_name ?? null,
    assets: (newest?.assets ?? []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
    stars: repo?.stargazers_count ?? null,
  };
}
