import { db } from './db';
import type { Channel } from '@/types/api';

/**
 * On-device copy of the channel list, so the sidebar can be drawn at app start before the server has answered.
 * It goes through the encrypted file cache (AES-GCM under the cache key, see cacheCrypto.ts), so names and message
 * previews are not readable from the profile folder. It holds no channel keys: those still come from the server.
 */

const cacheId = (userId: string) => `channels:${userId}`;

/**
 * Stores the list for the signed-in user. Failures (cache key unavailable, quota) are swallowed: this is only an
 * accelerator.
 *
 * @param userId - Owner of the list, so another account on the same device never sees it.
 * @param channels - The list as received from the server, with decrypted previews.
 */
export async function saveChannelCache(userId: string, channels: Channel[]): Promise<void> {
	try {
		const bytes = new TextEncoder().encode(JSON.stringify(channels));
		await db.cacheFile(cacheId(userId), bytes, 'application/json', bytes.byteLength);
	} catch {
		/* cache is best effort */
	}
}

/**
 * Reads the stored list.
 *
 * @param userId - Owner of the list.
 * @returns the channels, or null when nothing usable is stored.
 */
export async function loadChannelCache(userId: string): Promise<Channel[] | null> {
	try {
		const row = await db.getCachedFile(cacheId(userId));
		if (!row?.data?.byteLength) return null;
		const parsed: unknown = JSON.parse(new TextDecoder().decode(row.data));
		return Array.isArray(parsed) ? (parsed as Channel[]) : null;
	} catch {
		return null;
	}
}
