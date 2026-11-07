/**
 * Batch format shared with client-desktop/media_bridge.go (PackFrames). One batch crosses the Wails bridge as a
 * single base64 string, which is far cheaper than a JSON object per frame.
 * Record: src u16, kind u8, codec u8, flags u8, ts u32, len u32, data (big endian).
 */

/** Media kinds of docs/udp-media.md. */
export const KIND_AUDIO = 1;
export const KIND_VIDEO = 2;
export const KIND_SCREEN = 3;
/** Codec ids of docs/udp-media.md. */
export const CODEC_OPUS = 1;
export const CODEC_H264 = 3;
/** Flag bit 0: keyframe. */
export const FLAG_KEYFRAME = 1;

const HEADER = 13;

/** One encoded frame travelling between the webview and the Go UDP session. */
export interface PackedFrame {
	src: number;
	kind: number;
	codec: number;
	flags: number;
	ts: number;
	data: Uint8Array;
}

/** Encodes frames as consecutive records. */
export function packFrames(frames: readonly PackedFrame[]): Uint8Array {
	let n = 0;
	for (const f of frames) n += HEADER + f.data.length;
	const out = new Uint8Array(n);
	const v = new DataView(out.buffer);
	let o = 0;
	for (const f of frames) {
		v.setUint16(o, f.src);
		out[o + 2] = f.kind;
		out[o + 3] = f.codec;
		out[o + 4] = f.flags;
		v.setUint32(o + 5, f.ts >>> 0);
		v.setUint32(o + 9, f.data.length);
		out.set(f.data, o + HEADER);
		o += HEADER + f.data.length;
	}
	return out;
}

/**
 * Decodes {@link packFrames} output.
 * @throws Error when the batch is truncated.
 */
export function unpackFrames(b: Uint8Array): PackedFrame[] {
	const out: PackedFrame[] = [];
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let o = 0;
	while (o < b.length) {
		if (b.length - o < HEADER) throw new Error('media batch: truncated header');
		const len = v.getUint32(o + 9);
		if (b.length - o - HEADER < len) throw new Error('media batch: truncated frame');
		out.push({
			src: v.getUint16(o),
			kind: b[o + 2],
			codec: b[o + 3],
			flags: b[o + 4],
			ts: v.getUint32(o + 5),
			data: b.slice(o + HEADER, o + HEADER + len),
		});
		o += HEADER + len;
	}
	return out;
}

/** Base64 of a batch, in chunks so large frames do not overflow the argument limit of String.fromCharCode. */
export function batchToBase64(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
	return btoa(s);
}

/** Inverse of {@link batchToBase64}. */
export function base64ToBatch(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
