import Dexie, { type Table } from 'dexie';
import { decryptBytes } from './cacheCrypto';
import { logger } from '@/utils/logger';

export type WhisperExpiryMode = 'persistent' | '5m' | '1h' | '24h' | 'session_only';

export interface StoredWhisperSession {
	sessionId: string;
	peerId: string;
	peerUsername: string;
	sessionKey: CryptoKey;
	expiryMode: WhisperExpiryMode;
	safetyNumber: string;
	fingerprintHex: string;
	verified: boolean;
	createdAt: number;
	lastActivity: number;
}

/** The persisted shape: the session key is stored sealed (`wrappedKey`), never as a raw CryptoKey. */
type StoredSessionRow = Omit<StoredWhisperSession, 'sessionKey'> & {
	wrappedKey?: Uint8Array;
	/** Legacy rows written before keys were sealed; still readable, replaced when the session is saved again. */
	sessionKey?: CryptoKey;
};

export interface StoredWhisperMessage {
	id: string;
	sessionId: string;
	senderId: string;
	ciphertext: Uint8Array;
	nonce: Uint8Array;
	sentAt: number;
	expiresAt: number | null;
}

export class WhisperDB extends Dexie {
	sessions!: Table<StoredSessionRow, string>;
	messages!: Table<StoredWhisperMessage, string>;

	constructor() {
		super('CoveWhisperDB');

		this.version(1).stores({
			sessions: 'sessionId, peerId, createdAt, lastActivity',
			messages: 'id, sessionId, sentAt, expiresAt',
		});
	}

	/**
	 * Persists a session with its key sealed under the at-rest cache key.
	 *
	 * @param wrappedKey - `DerivedWhisperSecrets.wrappedSessionKey`; without it the session is not persisted, because
	 *        the only alternative is storing key material unprotected.
	 */
	async saveSession(session: StoredWhisperSession, wrappedKey: Uint8Array | undefined): Promise<void> {
		if (!wrappedKey) {
			logger.warn('whisper: session not persisted, no at-rest key available');
			return;
		}
		const { sessionKey: _runtimeKey, ...rest } = session;
		void _runtimeKey;
		await this.sessions.put({ ...rest, wrappedKey });
	}

	/** Unseals a stored row into a usable session, or undefined when its key cannot be recovered (locked). */
	private async hydrate(row: StoredSessionRow | undefined): Promise<StoredWhisperSession | undefined> {
		if (!row) return undefined;
		const { wrappedKey, sessionKey: legacyKey, ...rest } = row;
		if (wrappedKey) {
			try {
				const raw = await decryptBytes(wrappedKey);
				const sessionKey = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
					'encrypt',
					'decrypt',
				]);
				return { ...rest, sessionKey };
			} catch {
				return undefined;
			}
		}
		return legacyKey ? { ...rest, sessionKey: legacyKey } : undefined;
	}

	async getSession(sessionId: string): Promise<StoredWhisperSession | undefined> {
		return this.hydrate(await this.sessions.get(sessionId));
	}

	async getSessionByPeerId(peerId: string): Promise<StoredWhisperSession | undefined> {
		return this.hydrate(await this.sessions.where('peerId').equals(peerId).last());
	}

	async setSessionVerified(sessionId: string, verified: boolean): Promise<void> {
		await this.sessions.update(sessionId, { verified });
	}

	async saveMessage(msg: StoredWhisperMessage): Promise<void> {
		await this.messages.put(msg);
		await this.sessions.update(msg.sessionId, { lastActivity: Date.now() });
	}

	async getMessages(sessionId: string): Promise<StoredWhisperMessage[]> {
		return this.messages
			.where('sessionId')
			.equals(sessionId)
			.sortBy('sentAt');
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.transaction('rw', this.sessions, this.messages, async () => {
			await this.messages.where('sessionId').equals(sessionId).delete();
			await this.sessions.delete(sessionId);
		});
	}

	async purgeExpiredMessages(): Promise<number> {
		const now = Date.now();
		const expired = await this.messages
			.where('expiresAt')
			.belowOrEqual(now)
			.toArray();

		if (expired.length === 0) return 0;

		const ids = expired.map((m) => m.id);
		await this.messages.bulkDelete(ids);
		return ids.length;
	}

	async clearAllWhisperData(): Promise<void> {
		await this.transaction('rw', this.sessions, this.messages, async () => {
			await this.messages.clear();
			await this.sessions.clear();
		});
	}
}

export const whisperDb = new WhisperDB();
