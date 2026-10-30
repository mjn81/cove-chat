import { db } from './db';
import { whisperDb } from './whisperDb';
import { resetCacheKey } from './cacheCrypto';
import { logger } from '@/utils/logger';

/**
 * Deletes everything this device cached for the signed-in account: decrypted messages and files, and whisper
 * sessions. Called on sign-out and when the server ends the session, so the next person (or process) to look at
 * this profile finds nothing. Failures are logged, never thrown, so sign-out always completes.
 */
export async function wipeLocalData(): Promise<void> {
	resetCacheKey();
	await Promise.all([
		db.clearCategory('all').catch((err: unknown) => logger.warn('wipe: could not clear message cache', { err })),
		whisperDb.clearAllWhisperData().catch((err: unknown) => logger.warn('wipe: could not clear whisper data', { err })),
	]);
}
