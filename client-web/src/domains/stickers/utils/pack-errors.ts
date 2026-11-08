import { APIError } from '@/api/client';

/** Translate function shape this module needs (i18next's `t` satisfies it). */
type Translate = (key: string, options?: { defaultValue?: string }) => string;

/** Codes from docs/packs-api.md that have their own translated message under `stickers.errors.*`. */
const KNOWN = new Set([
	'pack_not_found',
	'pack_limit_reached',
	'emoji_name_taken',
	'pack_uploads_disabled',
	'image_invalid',
	'sticker_invalid',
	'payload_too_large',
	'rate_limited',
	'service_unavailable',
	'forbidden',
	'unauthorized',
]);

/**
 * The i18n key for an API failure on a pack, sticker or custom emoji request. The server's messages are plain
 * English plus a stable `code`, so the text shown comes from the code (docs/packs-api.md, error codes).
 *
 * @param err - Whatever the request threw.
 * @returns a key under `stickers.errors`, or null when the error has no known code (show the server message).
 */
export function packErrorKey(err: unknown): string | null {
	if (err instanceof APIError && err.code && KNOWN.has(err.code)) return `stickers.errors.${err.code}`;
	if (err instanceof APIError && err.status === 413) return 'stickers.errors.payload_too_large';
	return null;
}

/**
 * Display text for a failed pack request: the translated message for a known code, else the server's message,
 * else a generic one.
 *
 * @param err - Whatever the request threw.
 * @param t - Translate function.
 */
export function packErrorMessage(err: unknown, t: Translate): string {
	const key = packErrorKey(err);
	if (key) return t(key);
	if (err instanceof APIError && err.message) return err.message;
	return t('stickers.errors.generic');
}
