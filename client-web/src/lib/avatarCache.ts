import { useState, useEffect } from 'react';
import { db } from './db';
import { apiGetFile } from '@/api/client';

const memoryCache = new Map<string, string>();
const inFlightPromises = new Map<string, Promise<string | null>>();

function detectMimeType(bytes: Uint8Array): string {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 4 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		return 'image/gif';
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	// Check text/svg
	const header = new TextDecoder().decode(bytes.slice(0, 100));
	if (header.includes('<svg') || header.includes('<?xml')) {
		return 'image/svg+xml';
	}
	return 'image/jpeg';
}

/**
 * Loads an avatar from memory cache, IndexedDB, or fetches from the network.
 * Guaranteed to return an active Object URL or null.
 */
export async function loadAvatar(avatarId: string): Promise<string | null> {
	if (!avatarId) return null;

	// 1. Check in-memory cache for zero-latency synchronous access
	if (memoryCache.has(avatarId)) {
		return memoryCache.get(avatarId)!;
	}

	// 2. Reuse in-flight promise if multiple components request the same avatar
	if (inFlightPromises.has(avatarId)) {
		return inFlightPromises.get(avatarId)!;
	}

	const promise = (async () => {
		try {
			// 3. Check IndexedDB cache
			try {
				const cached = await db.getCachedFile(avatarId);
				if (cached && cached.data && cached.data.byteLength > 0) {
					const mime = cached.mime || detectMimeType(cached.data);
					const blob = new Blob([cached.data as BlobPart], { type: mime });
					const url = URL.createObjectURL(blob);
					memoryCache.set(avatarId, url);
					return url;
				}
			} catch {
				// IndexedDB might not be available or throw in restricted environments
			}

			// 4. Fallback to network fetch with Bearer authentication
			const buffer = await apiGetFile(avatarId);
			if (!buffer || buffer.byteLength === 0) return null;

			const bytes = new Uint8Array(buffer);
			const mime = detectMimeType(bytes);

			// Persist to IndexedDB if available
			try {
				await db.cacheFile(avatarId, bytes, mime, bytes.byteLength);
			} catch {
				// Ignore storage error
			}

			const blob = new Blob([bytes], { type: mime });
			const url = URL.createObjectURL(blob);
			memoryCache.set(avatarId, url);
			return url;
		} catch (err) {
			console.error(`[avatarCache] Failed to load avatar ${avatarId}:`, err);
			return null;
		} finally {
			inFlightPromises.delete(avatarId);
		}
	})();

	inFlightPromises.set(avatarId, promise);
	return promise;
}

/**
 * Invalidate a specific avatar from both memory and IndexedDB.
 */
export async function invalidateAvatar(avatarId: string): Promise<void> {
	if (!avatarId) return;

	if (memoryCache.has(avatarId)) {
		const existingUrl = memoryCache.get(avatarId)!;
		URL.revokeObjectURL(existingUrl);
		memoryCache.delete(avatarId);
	}

	try {
		await db.clearFileCache(avatarId);
	} catch {
		// Ignore if IndexedDB is not available
	}
}

/**
 * Evict any candidate avatar IDs that are no longer part of activeIds.
 */
export async function evictStaleAvatars(
	activeIds: string[],
	candidateIds: string[],
): Promise<void> {
	const activeSet = new Set(activeIds.filter(Boolean));
	const toEvict = candidateIds.filter((id) => id && !activeSet.has(id));

	await Promise.all(toEvict.map((id) => invalidateAvatar(id)));
}

/**
 * Pre-warm avatars into memory and IndexedDB.
 */
export async function prewarmAvatars(avatarIds: string[]): Promise<void> {
	const uniqueIds = Array.from(new Set(avatarIds.filter(Boolean)));
	await Promise.all(uniqueIds.map((id) => loadAvatar(id)));
}

/**
 * Hook for using cached avatars in React components.
 * Returns { url, isLoading }. url is available synchronously if in memory cache.
 */
export function useCachedAvatar(avatarId?: string) {
	const [url, setUrl] = useState<string | null>(() => {
		if (avatarId && memoryCache.has(avatarId)) {
			return memoryCache.get(avatarId)!;
		}
		return null;
	});

	const [isLoading, setIsLoading] = useState<boolean>(() => {
		return Boolean(avatarId && !memoryCache.has(avatarId));
	});

	useEffect(() => {
		if (!avatarId) {
			// Syncing local state with the (possibly cleared) id before the async load below.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setUrl(null);
			setIsLoading(false);
			return;
		}

		if (memoryCache.has(avatarId)) {
			setUrl(memoryCache.get(avatarId)!);
			setIsLoading(false);
			return;
		}

		let isMounted = true;
		setIsLoading(true);

		loadAvatar(avatarId).then((loadedUrl) => {
			if (isMounted) {
				setUrl(loadedUrl);
				setIsLoading(false);
			}
		});

		return () => {
			isMounted = false;
		};
	}, [avatarId]);

	return { url, isLoading };
}
