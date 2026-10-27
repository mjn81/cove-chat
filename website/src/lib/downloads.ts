import { LATEST_RELEASE_URL, DOCKER_SERVER_IMAGE } from './site';
import type { ReleaseAsset, ReleaseInfo } from './github';

export type OsId = 'windows' | 'macos' | 'linux' | 'android';

export interface DownloadEntry {
  id: string;
  label: string;
  os: OsId | 'docker' | 'web';
  /** Direct asset URL when a release provides it, else the releases page. */
  href: string;
  meta: string;
  available: boolean;
  /** Entries with a command render a copy button instead of a link. */
  copy?: string;
}

export interface DownloadGroup {
  id: 'server' | 'desktop' | 'mobile';
  entries: DownloadEntry[];
}

/** Asset names follow RELEASE_GUIDE.md / scripts/package_release.sh. */
const PATTERNS = {
  'server-windows': /server.*windows.*amd64/i,
  'server-linux': /server.*linux.*amd64/i,
  'server-macos': /server.*(darwin|mac)/i,
  'desktop-windows': /desktop.*windows/i,
  'desktop-macos': /desktop.*mac/i,
  'desktop-linux': /desktop.*linux/i,
  android: /\.apk$/i,
} as const;

type PatternKey = keyof typeof PATTERNS;

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function entry(assets: ReleaseAsset[], key: PatternKey, label: string, os: DownloadEntry['os']): DownloadEntry {
  const a = assets.find((x) => PATTERNS[key].test(x.name));
  return {
    id: key,
    label,
    os,
    href: a?.url ?? LATEST_RELEASE_URL,
    meta: a ? `${a.name.split('.').pop()?.toLowerCase()} - ${mb(a.size)}` : 'see releases',
    available: Boolean(a),
  };
}

/**
 * Builds the download matrix from the release's assets. Missing assets keep a working link to the
 * releases page so the page is useful before the first release is published.
 */
export function buildDownloads(info: ReleaseInfo): DownloadGroup[] {
  const { assets } = info;
  return [
    {
      id: 'server',
      entries: [
        entry(assets, 'server-windows', 'Windows (amd64)', 'windows'),
        entry(assets, 'server-linux', 'Linux (amd64)', 'linux'),
        entry(assets, 'server-macos', 'macOS (Intel / Apple silicon)', 'macos'),
        {
          id: 'docker',
          label: 'Docker image',
          os: 'docker',
          href: LATEST_RELEASE_URL,
          meta: 'docker pull',
          available: true,
          copy: `docker pull ${DOCKER_SERVER_IMAGE}`,
        },
      ],
    },
    {
      id: 'desktop',
      entries: [
        entry(assets, 'desktop-windows', 'Windows', 'windows'),
        entry(assets, 'desktop-macos', 'macOS (universal)', 'macos'),
        entry(assets, 'desktop-linux', 'Linux', 'linux'),
      ],
    },
    { id: 'mobile', entries: [entry(assets, 'android', 'Android APK', 'android')] },
  ];
}
