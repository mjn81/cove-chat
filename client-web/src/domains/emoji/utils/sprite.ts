import type { CSSProperties } from 'react';
import type { EmojiSpriteIndex } from '../types/emoji.types';

/**
 * CSS that shows one cell of a sprite sheet at `size` px: the sheet is scaled so a cell is exactly `size` wide and
 * the background is shifted to the emoji's cell.
 *
 * @param sheetUrl - Blob URL of the decoded sheet.
 * @param index - The style's sprite index (sheet size and cell size).
 * @param key - Emoji key (see `emojiKey`).
 * @param size - Rendered size in CSS pixels.
 * @returns The inline style, or null when the style has no image for this emoji (the caller draws the glyph).
 */
export function spriteStyle(
	sheetUrl: string,
	index: EmojiSpriteIndex,
	key: string,
	size: number,
): CSSProperties | null {
	const cell = index.emoji[key];
	if (!cell) return null;
	const scale = size / index.size;
	return {
		backgroundImage: `url("${sheetUrl}")`,
		backgroundRepeat: 'no-repeat',
		backgroundSize: `${index.width * scale}px ${index.height * scale}px`,
		backgroundPosition: `${-cell[0] * scale}px ${-cell[1] * scale}px`,
	};
}

/**
 * Key under which a style's sheet and index live in the IndexedDB file cache. It contains the style's content
 * version, so a re-generated sheet is a different entry and an old one is never served for new art.
 *
 * @param style - Style id.
 * @param version - Style content hash.
 * @param part - `sheet` or `index`.
 */
export function styleCacheKey(style: string, version: string, part: 'sheet' | 'index'): string {
	return `emoji:${style}:${version}:${part}`;
}

/** The pieces of a decoded style that drawing needs. */
export interface SpriteSource {
	sheetUrl: string;
	index: EmojiSpriteIndex;
}

/**
 * Sprite CSS from the active style, or, when that style has no image for the emoji (Noto has no flags or keycaps),
 * from the fallback style. Null means "draw the device glyph".
 *
 * @param primary - The active style, once loaded.
 * @param fallback - A full-coverage style used only for gaps, once loaded.
 * @param key - Emoji key.
 * @param size - Rendered size in px.
 */
export function pickSprite(
	primary: SpriteSource | null,
	fallback: SpriteSource | null,
	key: string,
	size: number,
): CSSProperties | null {
	for (const source of [primary, fallback]) {
		if (!source) continue;
		const style = spriteStyle(source.sheetUrl, source.index, key, size);
		if (style) return style;
	}
	return null;
}

/**
 * The style to borrow missing emoji from: a different, enabled, downloadable style with the most emoji (Twemoji
 * covers everything). Null when the server offers nothing else, in which case gaps use the device font.
 *
 * @param enabled - Enabled style ids.
 * @param active - The active style.
 * @param counts - Emoji count per style id.
 */
export function chooseFallbackStyle(enabled: readonly string[], active: string, counts: Readonly<Record<string, number>>): string | null {
	const candidates = enabled.filter((id) => id !== active && id !== 'native' && (counts[id] ?? 0) > 0);
	candidates.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
	return candidates[0] ?? null;
}

/**
 * Whether the active style lacks images for any of the given emoji keys. The picker uses it to decide whether the
 * fallback sheet is needed right away (styles such as Blobmoji, Fluent or FxEmojis have gaps in the very first
 * categories) or can wait until the user scrolls to flags and keycaps (the only gaps in Noto).
 *
 * @param index - The active style's index.
 * @param keys - Emoji keys that are about to be shown.
 */
export function hasGaps(index: EmojiSpriteIndex, keys: Iterable<string>): boolean {
	for (const key of keys) if (!index.emoji[key]) return true;
	return false;
}
