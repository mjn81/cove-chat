import { describe, it, expect } from 'vitest';
import { mirrorEmojiStyle, mirrorSegments } from './composer-mirror';

const source = { sheetUrl: 'blob:s', index: { size: 64, width: 640, height: 640, emoji: { '1f600': [128, 64] as [number, number] } } };

describe('mirrorSegments', () => {
	it('keeps the text exactly, emoji as their own segments', () => {
		const text = 'hi 😀 there 👍🏽\nok';
		const segs = mirrorSegments(text);
		expect(segs.map((s) => s.value).join('')).toBe(text);
		expect(segs.filter((s) => s.type === 'emoji').map((s) => s.value)).toEqual(['😀', '👍🏽']);
	});
	it('leaves shortcodes as typed text', () => {
		expect(mirrorSegments(':party_parrot:')).toEqual([{ type: 'text', value: ':party_parrot:' }]);
	});
	it('reserves the last empty line after a trailing newline', () => {
		expect(mirrorSegments('a\n').at(-1)).toEqual({ type: 'text', value: '​' });
		expect(mirrorSegments('a')).toHaveLength(1);
	});
});

describe('mirrorEmojiStyle', () => {
	it('is as wide as the textarea glyph and centres the sprite in it', () => {
		const s = mirrorEmojiStyle(source, null, '1f600', 24, 15);
		// 15px font: sprite 18px (scale 18/64), cell at x=128 -> -36px; centred in a 24px box: +3px.
		expect(s).toMatchObject({ width: 24, height: 18, backgroundPosition: '-33px -18px' });
		expect(s?.backgroundSize).toBe('180px 180px');
	});
	it('returns null without a sprite so the text glyph stays', () => {
		expect(mirrorEmojiStyle(source, null, '1f9ff', 24, 15)).toBeNull();
		expect(mirrorEmojiStyle(null, null, '1f600', 24, 15)).toBeNull();
	});
});
