import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { data: Uint8Array }>();
vi.mock('./db', () => ({
	db: {
		cacheFile: vi.fn(async (id: string, data: Uint8Array) => void store.set(id, { data })),
		getCachedFile: vi.fn(async (id: string) => store.get(id)),
	},
}));

import { loadChannelCache, saveChannelCache } from './channel-cache';
import type { Channel } from '@/types/api';

const list = [{ id: 'c1', name: 'général 😀', members: ['u1'] }] as unknown as Channel[];

describe('channel cache', () => {
	beforeEach(() => store.clear());

	it('round-trips the list including non-ASCII names', async () => {
		await saveChannelCache('u1', list);
		expect(await loadChannelCache('u1')).toEqual(list);
	});

	it('keeps accounts apart', async () => {
		await saveChannelCache('u1', list);
		expect(await loadChannelCache('u2')).toBeNull();
	});

	it('returns null for missing or damaged data instead of throwing', async () => {
		expect(await loadChannelCache('u1')).toBeNull();
		store.set('channels:u1', { data: new TextEncoder().encode('not json') });
		expect(await loadChannelCache('u1')).toBeNull();
		store.set('channels:u1', { data: new TextEncoder().encode('{"a":1}') });
		expect(await loadChannelCache('u1')).toBeNull();
	});
});
