import type { PackQuota } from '../types/stickers.types';

/** The server reads at most this much of an upload (docs/packs-api.md, rule 1). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Image types the server accepts for stickers, decided there by magic bytes; this is the client-side pre-check. */
export const STICKER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Why a file cannot be uploaded, as a stable code the UI translates. */
export type StickerFileProblem = 'type' | 'too_large' | 'pack_full' | 'storage_full' | 'uploads_disabled';

/**
 * Whether the bytes are an animated GIF or animated WebP. Animations are sent untouched (cropping would flatten
 * them), so the editor is skipped for them.
 *
 * @param bytes - The file's leading bytes (at least the first 64 KiB is plenty for WebP; GIF scans what it is given).
 * @param mime - The file's declared type, used only to pick the parser.
 */
export function isAnimatedImage(bytes: Uint8Array, mime: string): boolean {
	if (mime === 'image/gif') {
		// A GIF is animated when it has more than one image descriptor (0x2C) after the header.
		let images = 0;
		for (let i = 13; i < bytes.length && images < 2; i++) {
			if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) images++;
		}
		return images > 1;
	}
	if (mime === 'image/webp') {
		const ascii = (offset: number, text: string) => [...text].every((ch, k) => bytes[offset + k] === ch.charCodeAt(0));
		if (bytes.length < 21 || !ascii(0, 'RIFF') || !ascii(8, 'WEBP')) return false;
		// VP8X header: bit 1 of the flags byte is the animation flag.
		return ascii(12, 'VP8X') && (bytes[20] & 0x02) !== 0;
	}
	return false;
}

/**
 * Checks a chosen file against what the server will accept and what the caller still may create, so obvious
 * problems show before an upload starts. The server stays the authority and re-checks everything.
 *
 * @param file - The chosen file's type and size.
 * @param quota - Caps and usage from `GET /api/packs`, if loaded.
 * @param stickersInPack - How many stickers the target pack already holds.
 * @returns a problem code, or null when the upload may proceed.
 */
export function checkStickerFile(
	file: { type: string; size: number },
	quota: PackQuota | undefined,
	stickersInPack: number,
): StickerFileProblem | null {
	if (!(STICKER_MIME_TYPES as readonly string[]).includes(file.type)) return 'type';
	if (file.size > MAX_UPLOAD_BYTES) return 'too_large';
	if (quota) {
		if (!quota.user_uploads_enabled) return 'uploads_disabled';
		if (stickersInPack >= quota.max_stickers_per_pack) return 'pack_full';
		if (quota.used_storage_bytes >= quota.max_storage_bytes) return 'storage_full';
	}
	return null;
}

/**
 * Scales a size down to fit inside a square box without cropping or upscaling.
 *
 * @param width - Source width.
 * @param height - Source height.
 * @param box - Side of the square box (the server's `sticker_max_side`, 512).
 */
export function fitWithin(width: number, height: number, box: number): { width: number; height: number } {
	if (width <= box && height <= box) return { width, height };
	const scale = box / Math.max(width, height);
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether the user may create another pack, and why not. */
export function canCreatePack(quota: PackQuota | undefined): 'ok' | 'uploads_disabled' | 'pack_limit' {
	if (!quota) return 'ok';
	if (!quota.user_uploads_enabled) return 'uploads_disabled';
	return quota.owned_packs >= quota.max_packs ? 'pack_limit' : 'ok';
}
