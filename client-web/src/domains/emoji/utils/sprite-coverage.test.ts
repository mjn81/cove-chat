import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import data from '@emoji-mart/data';

import { emojiKey } from './emoji-text';
import { hasGaps, pickSprite } from './sprite';
import type { EmojiSpriteIndex } from '../types/emoji.types';

/**
 * Coverage of the sprite indexes the server ships (backend/internal/packs/assets) against every emoji the picker
 * offers (@emoji-mart/data, all skin tones). An emoji missing from the active style's index is drawn with the
 * fallback style, then the device font; these tests pin down exactly which ones are missing so a regression in the
 * code point mapping (ZWJ, skin tone, FE0F, flags, keycaps) cannot slip in unnoticed.
 */
const ASSETS = resolve(__dirname, '../../../../../backend/internal/packs/assets/emoji');
const loadIndex = (style: string): EmojiSpriteIndex =>
	JSON.parse(readFileSync(resolve(ASSETS, style, 'index.json'), 'utf8')) as EmojiSpriteIndex;

type RawEmoji = { id: string; skins: { native: string }[] };
const all = Object.values((data as unknown as { emojis: Record<string, RawEmoji> }).emojis).flatMap((e) =>
	e.skins.map((s, i) => ({ id: e.id, skin: i + 1, native: s.native, key: emojiKey(s.native) })),
);

const flagKeys = (k: string) => /^1f1[ef][0-9a-f]-1f1[ef][0-9a-f]$/.test(k) || k.startsWith('1f3f4-e00');
const keycap = (k: string) => k.endsWith('-20e3');

describe.skipIf(!existsSync(ASSETS))('sprite coverage', () => {
	it('picker data is what we think it is', () => {
		expect(all.length).toBeGreaterThan(3000);
		expect(emojiKey('❤️')).toBe('2764');
	});

	it('twemoji (the fallback style) has a cell for every emoji and skin tone in the picker', () => {
		const idx = loadIndex('twemoji');
		expect(all.filter((e) => !idx.emoji[e.key]).map((e) => e.native)).toEqual([]);
	});

	it('noto (the default) misses only flags, keycaps and copyright/registered', () => {
		const idx = loadIndex('noto');
		const missing = all.filter((e) => !idx.emoji[e.key]);
		const unexpected = missing.filter((e) => !flagKeys(e.key) && !keycap(e.key) && e.key !== 'a9' && e.key !== 'ae');
		expect(unexpected.map((e) => e.native)).toEqual([]);
		// Every skin-tone and ZWJ variant maps; the gaps are exactly the ones the fallback covers.
		expect(missing.length).toBeGreaterThan(0);
	});

	it('every cell lies inside its sheet', () => {
		for (const style of ['noto', 'twemoji']) {
			const idx = loadIndex(style);
			for (const [x, y] of Object.values(idx.emoji)) {
				expect(x).toBeGreaterThanOrEqual(0);
				expect(y).toBeGreaterThanOrEqual(0);
				expect(x + idx.size).toBeLessThanOrEqual(idx.width);
				expect(y + idx.size).toBeLessThanOrEqual(idx.height);
			}
		}
	});

	it('index keys never contain FE0F (the key rule)', () => {
		for (const style of ['noto', 'twemoji', 'blobmoji', 'fluent', 'fxemoji']) {
			expect(Object.keys(loadIndex(style).emoji).filter((k) => k.includes('fe0f'))).toEqual([]);
		}
	});
});

describe.skipIf(!existsSync(ASSETS))('no blank emoji', () => {
	const source = (style: string) => ({ sheetUrl: `blob:${style}`, index: loadIndex(style) });
	const fallback = source('twemoji');
	const flagOrKeycap = (k: string) => flagKeys(k) || keycap(k) || k === 'a9' || k === 'ae';

	// Recents are stored as plain characters, so they are resolved against whatever style is active when drawn.
	const recents = ['🫠', '🥲', '🫡', '😮‍💨', '❤️‍🔥', '🇩🇪', '1️⃣', '👍🏽', '🧑‍🤝‍🧑', '©️'];

	for (const style of ['noto', 'twemoji', 'blobmoji', 'fluent', 'fxemoji']) {
		it(`${style} + twemoji fallback draws an image for every picker emoji, skin tone and recent`, () => {
			const primary = source(style);
			const blanks = [...all.map((e) => e.key), ...recents.map(emojiKey)].filter((k) => !pickSprite(primary, fallback, k, 24));
			expect(blanks).toEqual([]);
		});
	}

	it('the default style only needs the fallback for flags, keycaps and the copyright signs', () => {
		const idx = loadIndex('noto');
		expect(hasGaps(idx, all.map((e) => e.key).filter((k) => !flagOrKeycap(k)))).toBe(false);
		expect(hasGaps(idx, all.map((e) => e.key))).toBe(true);
	});

	it('styles with real gaps in the first categories are detected, so the fallback loads at once', () => {
		const smileys = all.filter((e) => ['melting_face', 'face_holding_back_tears', 'saluting_face'].includes(e.id)).map((e) => e.key);
		expect(smileys.length).toBe(3);
		expect(hasGaps(loadIndex('blobmoji'), smileys)).toBe(true);
		expect(hasGaps(loadIndex('fxemoji'), smileys)).toBe(true);
		expect(hasGaps(loadIndex('noto'), smileys)).toBe(false);
	});
});

describe.skipIf(!existsSync(ASSETS))('newest Unicode emoji', () => {
	it('the default style has a sprite for every Unicode 14 and 15 emoji in the picker data', () => {
		const idx = loadIndex('noto');
		const raw = (data as unknown as { emojis: Record<string, { id: string; version?: number; skins: { native: string }[] }> }).emojis;
		const newest = Object.values(raw).filter((e) => (e.version ?? 0) >= 14);
		expect(newest.length).toBeGreaterThan(50);
		const missing = newest.flatMap((e) => e.skins.map((s) => s.native)).filter((c) => !idx.emoji[emojiKey(c)]);
		expect(missing).toEqual([]);
		// The melting face reported from the desktop app.
		expect(idx.emoji['1fae0']).toBeDefined();
	});
});
