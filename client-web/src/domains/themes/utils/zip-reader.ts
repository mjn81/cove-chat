import { inflateSync } from 'fflate';
import type { ThemeIssue } from './tokens';

/** Limits applied while reading an untrusted archive. */
export interface ZipLimits {
	/** Size of the whole archive file. */
	maxArchiveBytes: number;
	/** Number of entries (directories included). */
	maxEntries: number;
	/** Expanded size of one entry. */
	maxEntryBytes: number;
	/** Expanded size of all entries together. */
	maxTotalBytes: number;
	/** Largest allowed expanded/compressed ratio for an entry bigger than `ratioFloorBytes`. */
	maxRatio: number;
	/** Entries up to this expanded size are exempt from the ratio rule (tiny JSON compresses well legitimately). */
	ratioFloorBytes: number;
}

/** Successful read: file entries by name (directory entries are omitted). */
export type ZipResult =
	| { ok: true; entries: Map<string, Uint8Array> }
	| { ok: false; error: ThemeIssue };

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

/** CRC-32 (IEEE) as used by ZIP. */
export function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

const fail = (code: string, detail?: string): { ok: false; error: ThemeIssue } => ({
	ok: false,
	error: detail === undefined ? { code } : { code, detail },
});

interface CentralEntry {
	name: string;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	offset: number;
	isDir: boolean;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const MAX_NAME_BYTES = 200;
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * A safe archive path: relative, forward slashes only, no empty / `.` / `..` segments, no drive letters, no
 * control characters. Directory entries may end with a single `/`.
 */
function isSafeName(name: string): boolean {
	if (name.length === 0 || name.length > MAX_NAME_BYTES) return false;
	// eslint-disable-next-line no-control-regex -- control characters in a path are exactly what is being refused
	if (/[\u0000-\u001f\u007f\\]/.test(name)) return false;
	if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
	const trimmed = name.endsWith('/') ? name.slice(0, -1) : name;
	return trimmed.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function findEocd(b: Uint8Array, view: DataView): number {
	const min = Math.max(0, b.length - 22 - 0xffff);
	for (let i = b.length - 22; i >= min; i--) {
		if (view.getUint32(i, true) === EOCD_SIG) return i;
	}
	return -1;
}

/**
 * Reads a ZIP archive that came from an untrusted source.
 *
 * Everything is validated from the central directory before any data is inflated: entry count, names, symlinks,
 * encryption, declared sizes and ratio, overlapping data. Inflation then writes into a buffer of exactly the
 * declared size, so an entry that lies about its size fails instead of growing, and each result is checked against
 * its CRC. ZIP64, multi-disk archives and compression methods other than stored/deflate are refused.
 *
 * @param bytes The archive.
 * @param limits Size and count limits.
 * @returns The file entries, or the first problem found (`error.code` starts with `zip_`).
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits): ZipResult {
	if (bytes.length > limits.maxArchiveBytes) return fail('zip_too_large');
	if (bytes.length < 22) return fail('zip_invalid');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	const eocd = findEocd(bytes, view);
	if (eocd < 0) return fail('zip_invalid');
	const diskNo = view.getUint16(eocd + 4, true);
	const cdDisk = view.getUint16(eocd + 6, true);
	const entriesOnDisk = view.getUint16(eocd + 8, true);
	const totalEntries = view.getUint16(eocd + 10, true);
	const cdSize = view.getUint32(eocd + 12, true);
	const cdOffset = view.getUint32(eocd + 16, true);
	if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return fail('zip_unsupported', 'zip64');
	if (diskNo !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) return fail('zip_unsupported', 'multi-disk');
	if (totalEntries > limits.maxEntries) return fail('zip_too_many_entries');
	if (cdOffset + cdSize > eocd) return fail('zip_invalid');

	const central: CentralEntry[] = [];
	let p = cdOffset;
	for (let i = 0; i < totalEntries; i++) {
		if (p + 46 > eocd || view.getUint32(p, true) !== CEN_SIG) return fail('zip_invalid');
		const madeBy = view.getUint16(p + 4, true);
		const flags = view.getUint16(p + 8, true);
		const method = view.getUint16(p + 10, true);
		const crc = view.getUint32(p + 16, true);
		const compressedSize = view.getUint32(p + 20, true);
		const size = view.getUint32(p + 24, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const externalAttrs = view.getUint32(p + 38, true);
		const offset = view.getUint32(p + 42, true);
		if (nameLen > MAX_NAME_BYTES) return fail('zip_unsafe_path');
		if (p + 46 + nameLen + extraLen + commentLen > eocd) return fail('zip_invalid');

		let name: string;
		try {
			name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
		} catch {
			return fail('zip_unsafe_path');
		}
		if (!isSafeName(name)) return fail('zip_unsafe_path');
		if (flags & 1 || flags & 0x40) return fail('zip_encrypted');
		// "Version made by" high byte 3 = Unix: the mode is in the top half of the external attributes.
		if (madeBy >>> 8 === 3 && ((externalAttrs >>> 16) & 0o170000) === 0o120000) return fail('zip_symlink', name);
		if (method !== 0 && method !== 8) return fail('zip_unsupported', `method ${method}`);
		if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) return fail('zip_unsupported', 'zip64');

		central.push({ name, method, crc, compressedSize, size, offset, isDir: name.endsWith('/'), });
		p += 46 + nameLen + extraLen + commentLen;
	}

	const seen = new Set<string>();
	let total = 0;
	for (const e of central) {
		const key = e.name.toLowerCase();
		if (seen.has(key)) return fail('zip_duplicate', e.name);
		seen.add(key);
		if (e.isDir) continue;
		if (e.size > limits.maxEntryBytes) return fail('zip_bomb', e.name);
		total += e.size;
		if (total > limits.maxTotalBytes) return fail('zip_bomb');
		if (e.size > limits.ratioFloorBytes && e.size / Math.max(1, e.compressedSize) > limits.maxRatio) {
			return fail('zip_bomb', e.name);
		}
	}

	// Locate each entry's data and make sure no two entries share bytes (overlapping entries are how "quine"
	// bombs multiply a small payload).
	const spans: Array<[number, number, CentralEntry, number]> = [];
	for (const e of central) {
		if (e.isDir) continue;
		if (e.offset + 30 > cdOffset || view.getUint32(e.offset, true) !== LOC_SIG) return fail('zip_invalid', e.name);
		const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
		const end = start + e.compressedSize;
		if (end > cdOffset) return fail('zip_invalid', e.name);
		spans.push([e.offset, end, e, start]);
	}
	spans.sort((a, b) => a[0] - b[0]);
	for (let i = 1; i < spans.length; i++) {
		if (spans[i][0] < spans[i - 1][1]) return fail('zip_overlap');
	}

	const entries = new Map<string, Uint8Array>();
	for (const [, end, e, start] of spans) {
		const raw = bytes.subarray(start, end);
		let data: Uint8Array;
		if (e.method === 0) {
			if (e.compressedSize !== e.size) return fail('zip_corrupt', e.name);
			data = raw.slice();
		} else {
			try {
				// Fixed-size output: inflating more than the declared size throws instead of allocating.
				data = inflateSync(raw, { out: new Uint8Array(e.size) });
			} catch {
				return fail('zip_corrupt', e.name);
			}
			if (data.length !== e.size) return fail('zip_corrupt', e.name);
		}
		if (crc32(data) !== e.crc) return fail('zip_corrupt', e.name);
		entries.set(e.name, data);
	}
	return { ok: true, entries };
}
