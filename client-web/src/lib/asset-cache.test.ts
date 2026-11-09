import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { id: string; data: Uint8Array; mime: string }>();
vi.mock('./db', () => ({
	db: {
		getCachedFile: vi.fn(async (id: string) => store.get(id)),
		cacheFile: vi.fn(async (id: string, data: Uint8Array, mime: string) => {
			store.set(id, { id, data, mime });
		}),
	},
}));
const apiGetBinary = vi.fn();
vi.mock('@/api/client', () => ({ apiGetBinary: (p: string) => apiGetBinary(p) }));

if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = vi.fn();
const createObjectURL = vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(() => `blob:${Math.random()}`);

const { loadAssetBytes, loadAssetUrl, resetAssetCacheForTests } = await import('./asset-cache');

const webp = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;

describe('asset-cache', () => {
	beforeEach(() => {
		store.clear();
		apiGetBinary.mockReset();
		createObjectURL.mockClear();
		resetAssetCacheForTests();
	});

	it('downloads once, stores in IndexedDB and serves the second call from memory', async () => {
		apiGetBinary.mockResolvedValue(webp());
		const a = await loadAssetUrl('/api/x/1.webp');
		const b = await loadAssetUrl('/api/x/1.webp');
		expect(a).toBe(b);
		expect(apiGetBinary).toHaveBeenCalledTimes(1);
		expect(store.get('asset:/api/x/1.webp')?.mime).toBe('image/webp');
	});

	it('shares one download between concurrent callers', async () => {
		apiGetBinary.mockResolvedValue(webp());
		await Promise.all([loadAssetBytes('/api/x/2.webp'), loadAssetBytes('/api/x/2.webp')]);
		expect(apiGetBinary).toHaveBeenCalledTimes(1);
	});

	it('uses the IndexedDB copy without touching the network', async () => {
		store.set('asset:/api/x/3.webp', { id: 'asset:/api/x/3.webp', data: new Uint8Array(webp()), mime: 'image/webp' });
		expect(await loadAssetUrl('/api/x/3.webp')).toMatch(/^blob:/);
		expect(apiGetBinary).not.toHaveBeenCalled();
	});

	it('honours an explicit cache id', async () => {
		apiGetBinary.mockResolvedValue(webp());
		await loadAssetBytes('/api/sheet', 'emoji:noto:v1:sheet');
		expect(store.has('emoji:noto:v1:sheet')).toBe(true);
	});

	it('returns null on failure instead of throwing', async () => {
		apiGetBinary.mockRejectedValue(new Error('offline'));
		expect(await loadAssetUrl('/api/x/4.webp')).toBeNull();
		expect(await loadAssetBytes('/api/x/4.webp')).toBeNull();
	});
});
