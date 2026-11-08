import type { ThemeAsset } from '../types/themes.types';

/** What a header sniff learned about an image. */
export interface SniffedImage {
	mime: ThemeAsset['mime'];
	width: number;
	height: number;
}

const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const ascii = (b: Uint8Array, o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));

function sniffPng(b: Uint8Array): SniffedImage | null {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (b.length < 24 || !sig.every((v, i) => b[i] === v) || !ascii(b, 12, 'IHDR')) return null;
	return { mime: 'image/png', width: be32(b, 16), height: be32(b, 20) };
}

function sniffJpeg(b: Uint8Array): SniffedImage | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
	let o = 2;
	while (o + 4 <= b.length) {
		if (b[o] !== 0xff) return null;
		const marker = b[o + 1];
		if (marker === 0xff) {
			o += 1; // fill byte
			continue;
		}
		const len = be16(b, o + 2);
		// SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (o + 9 > b.length) return null;
			return { mime: 'image/jpeg', width: be16(b, o + 7), height: be16(b, o + 5) };
		}
		if (len < 2) return null; // would never advance
		o += 2 + len;
	}
	return null;
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
	if (b.length < 25 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
	if (ascii(b, 12, 'VP8X')) {
		if (b.length < 30) return null;
		return { mime: 'image/webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
	}
	if (ascii(b, 12, 'VP8L')) {
		if (b[20] !== 0x2f) return null;
		const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
		return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (ascii(b, 12, 'VP8 ')) {
		if (b.length < 30) return null;
		if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
		return { mime: 'image/webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
	}
	return null;
}

/**
 * Identifies an image from its first bytes and reads its pixel size from the header. Only PNG, JPEG and WebP are
 * recognised; everything else (SVG, GIF, HTML, archives) yields `null`, whatever the file name says.
 *
 * @param bytes File contents.
 * @returns The type and size, or `null` for anything that is not a well-formed header of an allowed type.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
	const found = sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes);
	if (!found || found.width < 1 || found.height < 1) return null;
	return found;
}
