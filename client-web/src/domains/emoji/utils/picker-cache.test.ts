import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPickerCategories, resetPickerCacheForTests } from './picker-cache';
import type { RawEmojiData } from './picker-data';

const data: RawEmojiData = {
	categories: [{ id: 'people', emojis: ['wave'] }],
	emojis: { wave: { id: 'wave', name: 'Wave', skins: [{ native: '👋' }, { native: '👋🏻' }, { native: '👋🏼' }] } },
};

describe('getPickerCategories', () => {
	beforeEach(() => resetPickerCacheForTests());

	it('loads and builds only once however often it is asked', async () => {
		const loader = vi.fn(async () => data);
		const a = await getPickerCategories(1, loader);
		const b = await getPickerCategories(1, loader);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(b).toBe(a);
	});

	it('shares the dataset between skin tones', async () => {
		const loader = vi.fn(async () => data);
		const base = await getPickerCategories(1, loader);
		const tone = await getPickerCategories(3, loader);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(base[0].emojis[0].native).toBe('👋');
		expect(tone[0].emojis[0].native).toBe('👋🏼');
	});
});
