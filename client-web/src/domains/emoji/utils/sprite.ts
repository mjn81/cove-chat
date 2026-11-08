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
