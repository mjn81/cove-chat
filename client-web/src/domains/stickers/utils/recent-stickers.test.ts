import { describe, it, expect } from 'vitest';
import { pruneRecentStickers, pushRecentSticker, type RecentSticker } from './recent-stickers';

const s = (pack: string, id: string): RecentSticker => ({ pack_id: pack, item: { id, url: `/u/${id}`, animated: false } });

describe('pushRecentSticker', () => {
	it('moves a repeated sticker to the front without duplicating it', () => {
		expect(pushRecentSticker([s('p', 'a'), s('p', 'b')], s('p', 'b')).map((r) => r.item.id)).toEqual(['b', 'a']);
	});
	it('treats the same id in another pack as a different sticker', () => {
		expect(pushRecentSticker([s('p', 'a')], s('q', 'a'))).toHaveLength(2);
	});
	it('caps the list', () => {
		expect(pushRecentSticker([s('p', 'a'), s('p', 'b')], s('p', 'c'), 2).map((r) => r.item.id)).toEqual(['c', 'a']);
	});
});

describe('pruneRecentStickers', () => {
	it('drops stickers of packs that are gone', () => {
		expect(pruneRecentStickers([s('p', 'a'), s('q', 'b')], new Set(['q'])).map((r) => r.item.id)).toEqual(['b']);
	});
});
