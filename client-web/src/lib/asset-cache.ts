import { useEffect, useState } from 'react';
import { db } from './db';
import { apiGetBinary } from '@/api/client';
import { detectMimeType } from './avatarCache';

/**
 * Blob-URL cache for immutable, versioned API assets (emoji sheets, animated emoji, custom emoji, stickers).
 * Same layering as `avatarCache`: memory, then the encrypted IndexedDB file cache, then the network. Entries are
 * keyed by API path, which contains the content version or an unguessable id, so a cached entry never goes stale.
 */

const memoryUrls = new Map<string, string>();
const inFlight = new Map<string, Promise<Uint8Array | null>>();
const inFlightUrls = new Map<string, Promise<string | null>>();

/** IndexedDB key for an API path. Prefixed so it can never collide with a file id. */
const cacheKey = (path: string) => `asset:${path}`;

/**
 * Loads the bytes of an asset from IndexedDB or the network and stores them for next time.
 *
 * @param path - API path of the asset.
 * @param cacheId - Override for the IndexedDB key (emoji sheets use a version-keyed id).
 * @returns The bytes, or null when it could not be fetched (the caller falls back, e.g. to the native glyph).
 */
export function loadAssetBytes(path: string, cacheId?: string): Promise<Uint8Array | null> {
	const id = cacheId ?? cacheKey(path);
	const pending = inFlight.get(id);
	if (pending) return pending;
	const promise = (async () => {
		try {
			const cached = await db.getCachedFile(id).catch(() => undefined);
			if (cached?.data && cached.data.byteLength > 0) return cached.data;
			const buffer = await apiGetBinary(path);
			if (!buffer || buffer.byteLength === 0) return null;
			const bytes = new Uint8Array(buffer);
			await db.cacheFile(id, bytes, detectMimeType(bytes), bytes.byteLength).catch(() => undefined);
			return bytes;
		} catch {
			return null;
		} finally {
			inFlight.delete(id);
		}
	})();
	inFlight.set(id, promise);
	return promise;
}

/**
 * Loads an asset as an object URL (memory cache first).
 *
 * @param path - API path of the image.
 */
export function loadAssetUrl(path: string): Promise<string | null> {
	const hit = memoryUrls.get(path);
	if (hit) return Promise.resolve(hit);
	const pending = inFlightUrls.get(path);
	if (pending) return pending;
	const promise = loadAssetBytes(path)
		.then((bytes) => {
			if (!bytes) return null;
			const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: detectMimeType(bytes) }));
			memoryUrls.set(path, url);
			return url;
		})
		.finally(() => inFlightUrls.delete(path));
	inFlightUrls.set(path, promise);
	return promise;
}

/**
 * Hook form of {@link loadAssetUrl}: the object URL once loaded, null while loading or when it failed.
 * Available synchronously when the image is already in memory, so scrolling back never flickers.
 *
 * @param path - API path of the image, or undefined to load nothing.
 */
export function useAssetUrl(path: string | undefined): string | null {
	const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
	useEffect(() => {
		if (!path || memoryUrls.has(path)) return;
		let alive = true;
		loadAssetUrl(path).then((url) => alive && setLoaded({ path, url }));
		return () => {
			alive = false;
		};
	}, [path]);
	if (!path) return null;
	return memoryUrls.get(path) ?? (loaded?.path === path ? loaded.url : null);
}

/** Test helper: forgets every in-memory URL. */
export function resetAssetCacheForTests(): void {
	memoryUrls.clear();
	inFlight.clear();
	inFlightUrls.clear();
}
