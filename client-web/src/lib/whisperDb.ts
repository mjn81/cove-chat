import Dexie, { type Table } from 'dexie';

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
	sessions!: Table<StoredWhisperSession, string>;
	messages!: Table<StoredWhisperMessage, string>;

	constructor() {
		super('CoveWhisperDB');

		this.version(1).stores({
			sessions: 'sessionId, peerId, createdAt, lastActivity',
			messages: 'id, sessionId, sentAt, expiresAt',
		});
	}

	async saveSession(session: StoredWhisperSession): Promise<void> {
		await this.sessions.put(session);
	}

	async getSession(sessionId: string): Promise<StoredWhisperSession | undefined> {
		return this.sessions.get(sessionId);
	}

	async getSessionByPeerId(peerId: string): Promise<StoredWhisperSession | undefined> {
		return this.sessions.where('peerId').equals(peerId).last();
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
