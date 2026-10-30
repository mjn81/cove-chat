import Dexie, { type Table } from 'dexie';
import type { Message } from '@/types/api';
import { decryptBytes, decryptText, encryptBytes, encryptText, isEncryptedText } from './cacheCrypto';
import { logger } from '@/utils/logger';

export interface CachedMessage extends Message {
	text?: string; // Decrypted content if available
}

export interface CachedFile {
	id: string; // File ID
	data: Uint8Array; // File bytes; AES-GCM encrypted at rest when `enc` is set (see lib/cacheCrypto.ts)
	enc?: boolean;
	mime: string;
	size?: number; // Size in bytes
	cached_at?: number; // Timestamp
}

export interface StorageCategoryStats {
	count: number;
	bytes: number;
}

export interface StorageStats {
	totalBytes: number;
	totalCount: number;
	images: StorageCategoryStats;
	videos: StorageCategoryStats;
	voices: StorageCategoryStats;
	otherFiles: StorageCategoryStats;
	messages: StorageCategoryStats;
}

export type StorageCategory =
	| 'all'
	| 'images'
	| 'videos'
	| 'voices'
	| 'otherFiles'
	| 'messages';

/**
 * CoveDB - Local IndexedDB for message and file persistence.
 * Implements a unified storage abstraction layer over Dexie.
 */
export class CoveDB extends Dexie {
	messages!: Table<CachedMessage>;
	files!: Table<CachedFile>;

	constructor() {
		super('CoveDB');

		this.version(2).stores({
			messages: 'id, channel_id, sent_at',
			files: 'id',
		});

		this.version(3).stores({
			messages: 'id, channel_id, sent_at',
			files: 'id, mime, cached_at',
		});
	}

	async cacheMessages(msgs: CachedMessage[]) {
		if (msgs.length === 0) return;
		let sealed: CachedMessage[];
		try {
			// The decrypted text is the sensitive part; it is encrypted under a key the profile folder does not hold.
			sealed = await Promise.all(
				msgs.map(async (m) => (m.text === undefined ? m : { ...m, text: await encryptText(m.text) })),
			);
		} catch (err) {
			// Key unavailable (app locked): skip caching rather than ever writing plaintext to disk.
			logger.warn('cache: message cache skipped, key unavailable', { err });
			return;
		}
		return this.messages.bulkPut(sealed);
	}

	async deleteMessage(id: string) {
		return this.messages.delete(id);
	}

	async getCachedMessages(
		channelId: string,
		limit: number = 50,
	): Promise<CachedMessage[]> {
		const rows = await this.messages.where('channel_id').equals(channelId).reverse().limit(limit).toArray();
		const opened = await Promise.all(
			rows.map(async (m) => {
				if (m.text === undefined || !isEncryptedText(m.text)) return m;
				try {
					return { ...m, text: await decryptText(m.text) };
				} catch {
					// Locked or unreadable: drop the text so the UI decrypts it from the live ciphertext instead.
					return { ...m, text: undefined };
				}
			}),
		);
		return opened.reverse();
	}

	async clearChannelCache(channelId: string) {
		return this.messages.where('channel_id').equals(channelId).delete();
	}

	// File Caching
	async cacheFile(
		id: string,
		data: Uint8Array,
		mime: string,
		size?: number,
	) {
		let stored: Uint8Array;
		try {
			stored = await encryptBytes(data);
		} catch (err) {
			logger.warn('cache: file cache skipped, key unavailable', { err });
			return;
		}
		return this.files.put({
			id,
			data: stored,
			enc: true,
			mime,
			size: size ?? data.byteLength,
			cached_at: Date.now(),
		});
	}

	async getCachedFile(id: string): Promise<CachedFile | undefined> {
		const row = await this.files.get(id);
		if (!row || !row.enc) return row;
		try {
			return { ...row, data: await decryptBytes(row.data), enc: false };
		} catch {
			return undefined; // unreadable (locked / key changed): behave as a cache miss and re-download
		}
	}

	async hasFile(id: string): Promise<boolean> {
		const count = await this.files.where('id').equals(id).count();
		return count > 0;
	}

	async clearFileCache(id: string) {
		return this.files.delete(id);
	}

	// Storage Analytics
	async getStorageStats(): Promise<StorageStats> {
		const allFiles = await this.files.toArray();
		const messageCount = await this.messages.count();

		const stats: StorageStats = {
			totalBytes: 0,
			totalCount: allFiles.length + messageCount,
			images: { count: 0, bytes: 0 },
			videos: { count: 0, bytes: 0 },
			voices: { count: 0, bytes: 0 },
			otherFiles: { count: 0, bytes: 0 },
			messages: { count: messageCount, bytes: 0 },
		};

		for (const file of allFiles) {
			const byteSize = file.size ?? file.data?.byteLength ?? 0;
			stats.totalBytes += byteSize;

			if (file.mime.startsWith('image/')) {
				stats.images.count++;
				stats.images.bytes += byteSize;
			} else if (file.mime.startsWith('video/')) {
				stats.videos.count++;
				stats.videos.bytes += byteSize;
			} else if (file.mime.startsWith('audio/')) {
				stats.voices.count++;
				stats.voices.bytes += byteSize;
			} else {
				stats.otherFiles.count++;
				stats.otherFiles.bytes += byteSize;
			}
		}

		// Approximate message payload size in IndexedDB (~300 bytes per message)
		const estimatedMsgBytes = messageCount * 300;
		stats.messages.bytes = estimatedMsgBytes;
		stats.totalBytes += estimatedMsgBytes;

		return stats;
	}

	// Selective Storage Purging
	async clearCategory(category: StorageCategory): Promise<void> {
		if (category === 'all') {
			await this.files.clear();
			await this.messages.clear();
			return;
		}

		if (category === 'messages') {
			await this.messages.clear();
			return;
		}

		const allFiles = await this.files.toArray();
		const idsToDelete: string[] = [];

		for (const file of allFiles) {
			if (category === 'images' && file.mime.startsWith('image/')) {
				idsToDelete.push(file.id);
			} else if (category === 'videos' && file.mime.startsWith('video/')) {
				idsToDelete.push(file.id);
			} else if (category === 'voices' && file.mime.startsWith('audio/')) {
				idsToDelete.push(file.id);
			} else if (
				category === 'otherFiles' &&
				!file.mime.startsWith('image/') &&
				!file.mime.startsWith('video/') &&
				!file.mime.startsWith('audio/')
			) {
				idsToDelete.push(file.id);
			}
		}

		if (idsToDelete.length > 0) {
			await this.files.bulkDelete(idsToDelete);
		}
	}
}

export const db = new CoveDB();
export const storageService = db;
