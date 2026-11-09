import type { CSSProperties } from 'react';
import type { EmojiSpriteIndex } from '../types/emoji.types';
import { tokenizeEmojiText } from './emoji-text';
import { pickSprite, type SpriteSource } from './sprite';

/** A piece of composer text to draw in the mirror layer. */
export type MirrorSegment = { type: 'text'; value: string } | { type: 'emoji'; value: string; key: string };

/**
 * Splits composer text for the mirror layer. Custom `:name:` shortcodes stay text (the composer holds them as typed).
 * A trailing newline gets a zero-width space after it, because a final empty line collapses in a normal block but
 * a textarea still reserves it, and the two layers must wrap identically.
 *
 * @param text - The textarea value (real Unicode, never markup).
 */
export function mirrorSegments(text: string): MirrorSegment[] {
	const segments: MirrorSegment[] = tokenizeEmojiText(text).map((t) =>
		t.type === 'emoji' ? { type: 'emoji', value: t.value, key: t.key } : { type: 'text', value: t.value },
	);
	if (text.endsWith('\n')) segments.push({ type: 'text', value: '​' });
	return segments;
}

/**
 * Inline style for one emoji in the mirror: a box exactly as wide as the glyph the textarea lays out (so the caret
 * and line wrapping stay aligned) with the sprite centred in it, at 1.2 times the font size.
 *
 * @param source - The active style, once loaded.
 * @param fallback - The gap-filling style.
 * @param key - Emoji key.
 * @param advance - Width in px the textarea gives this emoji (measured from the same font).
 * @param fontPx - Font size in px.
 * @returns the style, or null when no sprite exists (the glyph is then left to the mirror's own text).
 */
export function mirrorEmojiStyle(
	source: { sheetUrl: string; index: EmojiSpriteIndex } | null,
	fallback: SpriteSource | null,
	key: string,
	advance: number,
	fontPx: number,
): CSSProperties | null {
	const side = fontPx * 1.2;
	const sprite = pickSprite(source, fallback, key, side);
	if (!sprite) return null;
	const [px, py] = String(sprite.backgroundPosition).split(' ').map(parseFloat);
	return {
		...sprite,
		backgroundPosition: `${px + (advance - side) / 2}px ${py}px`,
		display: 'inline-block',
		width: advance,
		height: side,
		verticalAlign: 'text-bottom',
	};
}
