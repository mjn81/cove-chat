import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, pageItems, type Page } from './paging';

const page = (items: number[], next?: string): Page<number> => ({ items, next_cursor: next });

describe('fetchAllPages', () => {
	it('follows next_cursor until it is empty and concatenates the items', async () => {
		const fetchPage = vi
			.fn<(cursor?: string) => Promise<Page<number>>>()
			.mockResolvedValueOnce(page([1, 2], 'c1'))
			.mockResolvedValueOnce(page([3], 'c2'))
			.mockResolvedValueOnce(page([4], ''));
		await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2, 3, 4]);
		expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, 'c1', 'c2']);
	});

	it('stops at maxPages so a misbehaving server cannot loop forever', async () => {
		const fetchPage = vi.fn(async () => page([1], 'again'));
		const items = await fetchAllPages(fetchPage, 3);
		expect(items).toEqual([1, 1, 1]);
		expect(fetchPage).toHaveBeenCalledTimes(3);
	});

	it('propagates a failing page', async () => {
		const fetchPage = vi
			.fn<(cursor?: string) => Promise<Page<number>>>()
			.mockResolvedValueOnce(page([1], 'c1'))
			.mockRejectedValueOnce(new Error('boom'));
		await expect(fetchAllPages(fetchPage)).rejects.toThrow('boom');
	});
});

describe('pageItems', () => {
	it('tolerates a missing or null items array', () => {
		expect(pageItems(undefined)).toEqual([]);
		expect(pageItems(null)).toEqual([]);
		expect(pageItems({ items: null as unknown as number[] })).toEqual([]);
		expect(pageItems(page([1]))).toEqual([1]);
	});
});
