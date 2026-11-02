import { describe, expect, it } from 'vitest';
import { buildManifest, compareSemver, manifestKey, newestRelease, parseSums, type GhRelease } from './release-manifest';

const HEX = 'a'.repeat(64);

const release = (over: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: 'v0.10.0',
  name: 'Cove 0.10.0',
  body: ' notes ',
  html_url: 'https://github.com/mjn81/cove-chat/releases/tag/v0.10.0',
  draft: false,
  prerelease: true,
  published_at: '2026-11-02T10:00:00Z',
  assets: [
    { name: 'cove-server-linux-amd64.zip', size: 10, browser_download_url: 'https://dl/server' },
    { name: 'cove-desktop-mac-universal.zip', size: 20, browser_download_url: 'https://dl/mac' },
    { name: 'cove-android-0.10.0.apk', size: 30, browser_download_url: 'https://dl/apk' },
    { name: 'cove-android-0.10.0.aab', size: 40, browser_download_url: 'https://dl/aab' },
    { name: 'SHA256SUMS', size: 1, browser_download_url: 'https://dl/sums' },
  ],
  ...over,
});

const sums = (names: string[]) => names.map((n) => `${HEX}  ${n}`).join('\n');

describe('manifestKey', () => {
  it('maps release files to platform keys', () => {
    expect(manifestKey('cove-server-windows-amd64.zip')).toBe('server-windows-amd64');
    expect(manifestKey('cove-desktop-windows-amd64.zip')).toBe('windows-amd64');
    expect(manifestKey('cove-desktop-mac-universal.zip')).toBe('darwin-universal');
    expect(manifestKey('cove-desktop-linux-amd64.zip')).toBe('linux-amd64');
    expect(manifestKey('cove-android-1.0.0.apk')).toBe('android');
    expect(manifestKey('cove-android-1.0.0.aab')).toBeNull();
    expect(manifestKey('SHA256SUMS')).toBeNull();
  });
});

describe('buildManifest', () => {
  it('lists only files that have a checksum and marks 0.x as beta', () => {
    const m = buildManifest(release(), sums(['cove-server-linux-amd64.zip', 'cove-android-0.10.0.apk']));
    expect(m).not.toBeNull();
    expect(m?.channel).toBe('beta');
    expect(m?.version).toBe('0.10.0');
    expect(m?.notes).toBe('notes');
    expect(Object.keys(m?.assets ?? {}).sort()).toEqual(['android', 'server-linux-amd64']);
    expect(m?.assets['server-linux-amd64']).toEqual({ url: 'https://dl/server', sha256: HEX, size: 10 });
  });

  it('is stable for a non-pre-release', () => {
    const m = buildManifest(release({ tag_name: 'v1.0.0', prerelease: false }), sums(['cove-server-linux-amd64.zip']));
    expect(m?.channel).toBe('stable');
  });

  it('returns null when nothing can be verified', () => {
    expect(buildManifest(release(), '')).toBeNull();
  });
});

describe('parseSums', () => {
  it('reads both sha256sum separators', () => {
    const m = parseSums(`${HEX}  a.zip\n${'B'.repeat(64)} *b.zip\nnot a line`);
    expect(m.get('a.zip')).toBe(HEX);
    expect(m.get('b.zip')).toBe('b'.repeat(64));
    expect(m.size).toBe(2);
  });
});

describe('newestRelease', () => {
  it('picks the highest semver, not the first listed, and skips drafts', () => {
    const list = [
      release({ tag_name: 'v0.9.10' }),
      release({ tag_name: 'v0.10.0' }),
      release({ tag_name: 'v9.0.0', draft: true }),
      release({ tag_name: 'v0.9.9' }),
    ];
    expect(newestRelease(list)?.tag_name).toBe('v0.10.0');
  });
});

describe('compareSemver', () => {
  it('orders versions with pre-release rules', () => {
    expect(compareSemver('0.9.10', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
  });
});
