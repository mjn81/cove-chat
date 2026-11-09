import type { PackItem, StickerBody } from '../types/stickers.types';

/** Longest pack or sticker id the server accepts in a sticker message. */
const MAX_ID = 128;

/**
 * Builds the body of a `sticker` message (the text that gets encrypted) from a pack item.
 *
 * @param packId - Pack the sticker belongs to.
 * @param item - The sticker. Built-in stickers have no `file_id`, which is sent as an empty string.
 */
export function encodeSticker(packId: string, item: Pick<PackItem, 'id' | 'file_id'>): string {
	const body: StickerBody = { pack_id: packId, sticker_id: item.id, file_id: item.file_id ?? '' };
	return JSON.stringify(body);
}

/**
 * Reads the decrypted text of a `sticker` message.
 *
 * @param text - Decrypted message text.
 * @returns the body, or null when the text is not a valid sticker body (the bubble then shows a short notice).
 */
export function parseSticker(text: string | undefined): StickerBody | null {
	if (!text) return null;
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
	const { pack_id, sticker_id, file_id } = data as Record<string, unknown>;
	if (typeof pack_id !== 'string' || pack_id === '' || pack_id.length > MAX_ID) return null;
	if (typeof sticker_id !== 'string' || sticker_id === '' || sticker_id.length > MAX_ID) return null;
	if (file_id !== undefined && typeof file_id !== 'string') return null;
	return { pack_id, sticker_id, file_id: file_id ?? '' };
}

/**
 * API path of a sticker image that a message points at without needing the pack: stored stickers are channel-less
 * files addressed by `file_id`. Built-in stickers return null; their URL is versioned and comes from the pack detail.
 *
 * @param body - A parsed sticker body.
 */
export function stickerFilePath(body: StickerBody): string | null {
	return body.file_id && body.file_id !== body.sticker_id ? `/api/files/${encodeURIComponent(body.file_id)}` : null;
}

/** Short text for chat previews and replies, e.g. "🙂 Sticker": the emoji when known, else just the label. */
export function stickerPreviewLabel(label: string, emoji?: string): string {
	return emoji ? `${emoji} ${label}` : label;
}
