import { describe, it, expect } from 'vitest';
import { buildCategories, searchEmoji, type RawEmojiData } from './picker-data';

const raw: RawEmojiData = {
	categories: [
		{ id: 'people', emojis: ['grinning', 'ghost', 'missing'] },
		{ id: 'nature', emojis: ['cat'] },
	],
	emojis: {
		grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['smile', 'happy'], skins: [{ native: '😀' }] },
		ghost: { id: 'ghost', name: 'Ghost', keywords: ['halloween', 'spooky'], skins: [{ native: '👻' }] },
		cat: { id: 'cat', name: 'Cat Face', skins: [{ native: '🐱' }] },
	},
};

describe('buildCategories', () => {
	it('keeps order and drops unknown ids', () => {
		const c = buildCategories(raw);
		expect(c.map((x) => x.id)).toEqual(['people', 'nature']);
		expect(c[0].emojis.map((e) => e.native)).toEqual(['😀', '👻']);
		expect(c[1].emojis[0].keywords).toEqual([]);
	});
});

describe('searchEmoji', () => {
	const cats = buildCategories(raw);
	it('matches names and keywords', () => {
		expect(searchEmoji(cats, 'ghost').map((e) => e.id)).toEqual(['ghost']);
		expect(searchEmoji(cats, 'happy').map((e) => e.id)).toEqual(['grinning']);
	});
	it('requires every word', () => {
		expect(searchEmoji(cats, 'cat face').map((e) => e.id)).toEqual(['cat']);
		expect(searchEmoji(cats, 'cat happy')).toEqual([]);
	});
	it('ranks name matches above keyword matches', () => {
		const c = buildCategories({
			categories: [{ id: 'x', emojis: ['a', 'b'] }],
			emojis: {
				a: { id: 'a', name: 'Alpha', keywords: ['star'], skins: [{ native: 'A' }] },
				b: { id: 'b', name: 'Star', skins: [{ native: 'B' }] },
			},
		});
		expect(searchEmoji(c, 'star').map((e) => e.id)).toEqual(['b', 'a']);
	});
	it('returns nothing for an empty query', () => {
		expect(searchEmoji(cats, '   ')).toEqual([]);
	});
});
