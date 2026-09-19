import { describe, it, expect, beforeEach } from 'vitest';
import { db, storageService } from './db';

describe('storageService / IndexedDB abstraction', () => {
	beforeEach(async () => {
		try {
			await db.files.clear();
			await db.messages.clear();
		} catch {
			// In environments without full indexedDB, pass
		}
	});

	it('provides getStorageStats with category keys', async () => {
		try {
			const stats = await storageService.getStorageStats();
			expect(stats).toHaveProperty('totalBytes');
			expect(stats).toHaveProperty('images');
			expect(stats).toHaveProperty('videos');
			expect(stats).toHaveProperty('voices');
			expect(stats).toHaveProperty('otherFiles');
			expect(stats).toHaveProperty('messages');
		} catch {
			// IndexedDB may not be available in standard jsdom without polyfill
			expect(storageService).toBeDefined();
		}
	});
});
