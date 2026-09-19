import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as clientApi from '@/api/client';

if (!globalThis.URL.createObjectURL) {
	globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random()}`);
}
if (!globalThis.URL.revokeObjectURL) {
	globalThis.URL.revokeObjectURL = vi.fn();
}

const mockFileStore = new Map<string, any>();
vi.mock('./db', () => ({
	db: {
		getCachedFile: vi.fn(async (id: string) => mockFileStore.get(id)),
		cacheFile: vi.fn(async (id: string, data: Uint8Array, mime: string) => {
			mockFileStore.set(id, { id, data, mime });
		}),
		clearFileCache: vi.fn(async (id: string) => {
			mockFileStore.delete(id);
		}),
	},
}));

vi.mock('@/api/client', () => ({
	apiGetFile: vi.fn(),
	getFileUrl: (id: string) => `/api/files/${id}`,
}));

// Import avatarCache after mocks
const {
	loadAvatar,
	invalidateAvatar,
	evictStaleAvatars,
	prewarmAvatars,
} = await import('./avatarCache');

describe('avatarCache', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFileStore.clear();
	});

	it('returns null for empty avatarId', async () => {
		const result = await loadAvatar('');
		expect(result).toBeNull();
	});

	it('fetches from apiGetFile when not in cache, stores in db, and returns blob URL', async () => {
		const fakeBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer; // JPEG magic bytes
		vi.spyOn(clientApi, 'apiGetFile').mockResolvedValue(fakeBuffer as any);

		const url = await loadAvatar('avatar-test-1');
		expect(url).toBeDefined();
		expect(typeof url).toBe('string');
		expect(clientApi.apiGetFile).toHaveBeenCalledWith('avatar-test-1');

		// Subsequent call should hit cache without calling apiGetFile again
		const secondUrl = await loadAvatar('avatar-test-1');
		expect(secondUrl).toBe(url);
		expect(clientApi.apiGetFile).toHaveBeenCalledTimes(1);
	});

	it('invalidates an avatar from cache', async () => {
		const fakeBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer; // PNG magic bytes
		vi.spyOn(clientApi, 'apiGetFile').mockResolvedValue(fakeBuffer as any);

		await loadAvatar('avatar-test-2');
		await invalidateAvatar('avatar-test-2');

		// After invalidation, loadAvatar should fetch again
		await loadAvatar('avatar-test-2');
		expect(clientApi.apiGetFile).toHaveBeenCalledTimes(2);
	});

	it('evicts stale avatars not in the active set', async () => {
		const fakeBuffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
		vi.spyOn(clientApi, 'apiGetFile').mockResolvedValue(fakeBuffer as any);

		await loadAvatar('avatar-keep');
		await loadAvatar('avatar-delete-1');
		await loadAvatar('avatar-delete-2');

		await evictStaleAvatars(['avatar-keep'], ['avatar-keep', 'avatar-delete-1', 'avatar-delete-2']);

		// avatar-delete-1 should now be evicted and fetch again
		await loadAvatar('avatar-delete-1');
		expect(clientApi.apiGetFile).toHaveBeenCalledWith('avatar-delete-1');
	});

	it('prewarms multiple avatars', async () => {
		const fakeBuffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
		vi.spyOn(clientApi, 'apiGetFile').mockResolvedValue(fakeBuffer as any);

		await prewarmAvatars(['prewarm-1', 'prewarm-2']);
		expect(clientApi.apiGetFile).toHaveBeenCalledWith('prewarm-1');
		expect(clientApi.apiGetFile).toHaveBeenCalledWith('prewarm-2');
	});
});
