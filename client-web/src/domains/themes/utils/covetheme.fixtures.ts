/**
 * Test-only builders for `.covetheme` archives and images. Not imported by app code.
 *
 * `rawZip` writes a ZIP byte by byte so tests can produce hostile archives (symlinks, lying sizes, encrypted
 * entries, overlapping data) that a well-behaved library would refuse to create.
 */
import { crc32 } from './zip-reader';

/** One archive member for {@link rawZip}. */
export interface RawEntry {
	name: string;
	data: Uint8Array;
	/** 0 = stored (default), 8 = deflate (data must already be a raw deflate stream). */
	method?: 0 | 8;
	/** Uncompressed size to declare; defaults to the real one (`data.length` when stored). */
	declaredSize?: number;
	/** CRC to declare; defaults to the CRC of `data` when stored. */
	crc?: number;
	/** Unix mode in the high 16 bits of the external attributes (needs `os: 3`). */
	unixMode?: number;
	flags?: number;
	/** "Version made by" host; 3 = Unix. */
	os?: number;
	/** Local header offset to declare, to craft overlaps. */
	offsetOverride?: number;
}

const enc = new TextEncoder();

function u16(n: number): number[] {
	return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
	return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Builds a ZIP exactly as described by `entries`. */
export function rawZip(entries: RawEntry[], opts: { comment?: string } = {}): Uint8Array {
	const out: number[] = [];
	const central: number[] = [];
	for (const e of entries) {
		const name = enc.encode(e.name);
		const method = e.method ?? 0;
		const size = e.declaredSize ?? e.data.length;
		const crc = e.crc ?? crc32(e.data);
		const offset = out.length;
		out.push(
			...u32(0x04034b50), ...u16(20), ...u16(e.flags ?? 0), ...u16(method), ...u16(0), ...u16(0),
			...u32(crc), ...u32(e.data.length), ...u32(size), ...u16(name.length), ...u16(0),
			...name,
		);
		for (const b of e.data) out.push(b);
		central.push(
			...u32(0x02014b50), ...u16(((e.os ?? 0) << 8) | 20), ...u16(20), ...u16(e.flags ?? 0), ...u16(method),
			...u16(0), ...u16(0), ...u32(crc), ...u32(e.data.length), ...u32(size), ...u16(name.length),
			...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(((e.unixMode ?? 0) << 16) >>> 0),
			...u32(e.offsetOverride ?? offset), ...name,
		);
	}
	const cdOffset = out.length;
	out.push(...central);
	const comment = enc.encode(opts.comment ?? '');
	out.push(
		...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
		...u32(central.length), ...u32(cdOffset), ...u16(comment.length), ...comment,
	);
	return Uint8Array.from(out);
}

/** A stored (uncompressed) entry from text. */
export function textEntry(name: string, text: string): RawEntry {
	return { name, data: enc.encode(text) };
}

/** Minimal PNG: signature plus an IHDR chunk with the given size (enough for header sniffing). */
export function makePng(width: number, height: number, extra = 0): Uint8Array {
	const be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
	return Uint8Array.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		...be(13), 0x49, 0x48, 0x44, 0x52, ...be(width), ...be(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
		...new Array(extra).fill(0),
	]);
}

/** Minimal JPEG: SOI, an APP0 segment, then SOF0 carrying the size. */
export function makeJpeg(width: number, height: number): Uint8Array {
	return Uint8Array.from([
		0xff, 0xd8,
		0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
		0xff, 0xc0, 0x00, 0x0b, 8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 1, 1, 0x11, 0,
		0xff, 0xd9,
	]);
}

function riff(chunks: number[]): Uint8Array {
	const size = 4 + chunks.length;
	return Uint8Array.from([0x52, 0x49, 0x46, 0x46, ...u32(size), 0x57, 0x45, 0x42, 0x50, ...chunks]);
}

/** Minimal extended WebP (`VP8X`). */
export function makeWebpX(width: number, height: number): Uint8Array {
	const w = width - 1;
	const h = height - 1;
	return riff([
		0x56, 0x50, 0x38, 0x58, ...u32(10), 0, 0, 0, 0,
		w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
	]);
}

/** Minimal lossless WebP (`VP8L`). */
export function makeWebpL(width: number, height: number): Uint8Array {
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	return riff([0x56, 0x50, 0x38, 0x4c, ...u32(5), 0x2f, ...u32(bits)]);
}

/** Minimal lossy WebP (`VP8 `). */
export function makeWebpLossy(width: number, height: number): Uint8Array {
	return riff([
		0x56, 0x50, 0x38, 0x20, ...u32(10), 0, 0, 0, 0x9d, 0x01, 0x2a,
		...u16(width & 0x3fff), ...u16(height & 0x3fff),
	]);
}

/** A `theme.json` object that passes validation; tests override pieces. */
export function validThemeJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		format: 'cove-theme',
		version: 1,
		id: 'test-theme',
		name: { en: 'Test theme', fa: 'پوسته آزمایشی', ar: 'سمة تجريبية' },
		author: 'Someone',
		license: 'CC0-1.0',
		base: 'dark',
		tokens: {
			background: '0 0% 10%',
			foreground: '0 0% 95%',
			card: '0 0% 14%',
			'card-foreground': '0 0% 95%',
			popover: '0 0% 8%',
			'popover-foreground': '0 0% 95%',
			primary: '13 59% 63%',
			'primary-foreground': '0 0% 5%',
			secondary: '0 0% 14%',
			'secondary-foreground': '0 0% 95%',
			muted: '0 0% 14%',
			'muted-foreground': '0 0% 70%',
			accent: '0 0% 20%',
			'accent-foreground': '0 0% 95%',
			destructive: '355 83% 66%',
			'destructive-foreground': '0 0% 5%',
			border: '0 0% 25%',
			input: '0 0% 25%',
			ring: '13 59% 63%',
		},
		...overrides,
	};
}

/** Encodes a JSON value as a stored `theme.json` entry. */
export function themeJsonEntry(json: unknown): RawEntry {
	return textEntry('theme.json', JSON.stringify(json));
}
