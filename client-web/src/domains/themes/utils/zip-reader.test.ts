import { deflateSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { rawZip, textEntry } from './covetheme.fixtures';
import { crc32, readZip, type ZipLimits } from './zip-reader';

const LIMITS: ZipLimits = {
	maxArchiveBytes: 100_000,
	maxEntries: 5,
	maxEntryBytes: 10_000,
	maxTotalBytes: 20_000,
	maxRatio: 100,
	ratioFloorBytes: 1_000,
};

const enc = new TextEncoder();

function code(r: ReturnType<typeof readZip>): string | undefined {
	return r.ok ? undefined : r.error.code;
}

describe('readZip: happy path', () => {
	it('reads stored and deflated entries (as produced by a normal zip tool)', () => {
		const zip = zipSync({ 'theme.json': enc.encode('{"a":1}'), 'assets/bg.png': [new Uint8Array(500).fill(7), { level: 9 }] });
		const r = readZip(zip, LIMITS);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(new TextDecoder().decode(r.entries.get('theme.json'))).toBe('{"a":1}');
		expect(r.entries.get('assets/bg.png')).toHaveLength(500);
	});

	it('skips directory entries', () => {
		const r = readZip(rawZip([{ name: 'assets/', data: new Uint8Array(0) }, textEntry('theme.json', '{}')]), LIMITS);
		expect(r.ok && [...r.entries.keys()]).toEqual(['theme.json']);
	});

	it('tolerates an archive comment', () => {
		expect(readZip(rawZip([textEntry('theme.json', '{}')], { comment: 'hello' }), LIMITS).ok).toBe(true);
	});
});

describe('readZip: structure', () => {
	it.each([
		['empty input', new Uint8Array(0)],
		['plain text', enc.encode('not a zip at all')],
		['truncated', rawZip([textEntry('theme.json', '{}')]).slice(0, 30)],
	])('rejects %s', (_n, bytes) => {
		expect(code(readZip(bytes, LIMITS))).toBe('zip_invalid');
	});

	it('rejects oversized archives before parsing', () => {
		expect(code(readZip(new Uint8Array(LIMITS.maxArchiveBytes + 1), LIMITS))).toBe('zip_too_large');
	});

	it('rejects too many entries', () => {
		const entries = Array.from({ length: 6 }, (_, i) => textEntry(`assets/${i}.png`, 'x'));
		expect(code(readZip(rawZip(entries), LIMITS))).toBe('zip_too_many_entries');
	});

	it('rejects encrypted entries', () => {
		expect(code(readZip(rawZip([{ ...textEntry('theme.json', '{}'), flags: 1 }]), LIMITS))).toBe('zip_encrypted');
	});

	it('rejects unsupported compression methods', () => {
		const e = { ...textEntry('theme.json', '{}'), method: 8 as const };
		// Declared deflate but the data is not a deflate stream with a valid CRC: never inflated blindly.
		expect(readZip(rawZip([e]), LIMITS).ok).toBe(false);
	});

	it('rejects duplicate names, including case-only differences', () => {
		expect(code(readZip(rawZip([textEntry('theme.json', '{}'), textEntry('THEME.json', '{}')]), LIMITS))).toBe('zip_duplicate');
	});

	it('rejects overlapping entry data', () => {
		const zip = rawZip([textEntry('a', 'aaaa'), { ...textEntry('b', 'bbbb'), offsetOverride: 0 }]);
		expect(code(readZip(zip, LIMITS))).toBe('zip_overlap');
	});
});

describe('readZip: hostile paths', () => {
	it.each([
		'../evil.txt',
		'assets/../../evil.txt',
		'/etc/passwd',
		'C:/Windows/x',
		'c:\\x',
		'assets\\..\\x',
		'a//b',
		'./theme.json',
		'assets/./x.png',
		'a/b\u0000.png',
		'a/\u0007.png',
		'',
	])('rejects the entry name %j', (name) => {
		expect(code(readZip(rawZip([textEntry(name, 'x')]), LIMITS))).toBe('zip_unsafe_path');
	});

	it('rejects absurdly long names', () => {
		expect(code(readZip(rawZip([textEntry('a'.repeat(300), 'x')]), LIMITS))).toBe('zip_unsafe_path');
	});

	it('rejects symlinks', () => {
		const link = { ...textEntry('assets/link.png', '/etc/passwd'), os: 3, unixMode: 0o120777 };
		expect(code(readZip(rawZip([link]), LIMITS))).toBe('zip_symlink');
	});

	it('accepts ordinary unix file modes', () => {
		const file = { ...textEntry('theme.json', '{}'), os: 3, unixMode: 0o100644 };
		expect(readZip(rawZip([file]), LIMITS).ok).toBe(true);
	});
});

describe('readZip: bombs and lies', () => {
	it('rejects an entry whose declared size exceeds the per-entry limit', () => {
		const e = { ...textEntry('a.bin', 'x'), declaredSize: LIMITS.maxEntryBytes + 1 };
		expect(code(readZip(rawZip([e]), LIMITS))).toBe('zip_bomb');
	});

	it('rejects when the total expanded size exceeds the limit', () => {
		const big = deflateSync(new Uint8Array(9_000));
		const mk = (n: string) => ({ name: n, data: big, method: 8 as const, declaredSize: 9_000, crc: crc32(new Uint8Array(9_000)) });
		expect(code(readZip(rawZip([mk('a'), mk('b'), mk('c')]), { ...LIMITS, maxRatio: 10_000 }))).toBe('zip_bomb');
	});

	it('rejects an extreme compression ratio', () => {
		const zeros = new Uint8Array(9_000);
		const e = { name: 'a.bin', data: deflateSync(zeros, { level: 9 }), method: 8 as const, declaredSize: 9_000, crc: crc32(zeros) };
		expect(code(readZip(rawZip([e]), LIMITS))).toBe('zip_bomb');
	});

	it('does not trust a size that is smaller than the real expansion', () => {
		const real = new Uint8Array(9_000).map((_, i) => (i * 31) & 0xff);
		const data = deflateSync(real);
		const e = { name: 'a.bin', data, method: 8 as const, declaredSize: 100, crc: crc32(real) };
		const r = readZip(rawZip([e]), { ...LIMITS, maxRatio: 10_000 });
		expect(r.ok).toBe(false);
	});

	it('rejects a CRC mismatch', () => {
		const e = { ...textEntry('theme.json', '{}'), crc: 123 };
		expect(code(readZip(rawZip([e]), LIMITS))).toBe('zip_corrupt');
	});

	it('rejects local data running past the end of the archive', () => {
		const zip = rawZip([textEntry('theme.json', '{"a":1}')]);
		// Corrupt the stored size in the central directory so the data would run beyond the file.
		const view = new DataView(zip.buffer);
		const cd = zip.length - 22 - (46 + 'theme.json'.length);
		view.setUint32(cd + 20, 5_000, true);
		expect(readZip(zip, LIMITS).ok).toBe(false);
	});

	it('rejects ZIP64 archives', () => {
		const zip = rawZip([textEntry('theme.json', '{}')]);
		const view = new DataView(zip.buffer);
		view.setUint16(zip.length - 22 + 10, 0xffff, true); // total entries marker
		expect(code(readZip(zip, LIMITS))).toBe('zip_unsupported');
	});
});
