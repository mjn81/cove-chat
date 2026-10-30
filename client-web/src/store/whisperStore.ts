import { create } from 'zustand';
import {
	generateWhisperKeypair,
	exportPublicKey,
	importPublicKey,
	deriveWhisperSecrets,
	whisperEncryptPayload,
	whisperDecryptPayload,
	fileToBase64,
	base64ToBlobUrl,
	uint8ArrayToBase64,
	base64ToUint8Array,
	type WhisperPayloadData,
} from '@/lib/whisperCrypto';
import {
	whisperDb,
	type WhisperExpiryMode,
} from '@/lib/whisperDb';
import {
	onWS,
	wsSendWhisperInit,
	wsSendWhisperAccept,
	wsSendWhisperReject,
	wsSendWhisperMsg,
	wsSendWhisperClose,
} from '@/ws';
import { useAuthStore } from './auth.slice';
import { useChannelStore } from './channels.slice';

export interface WhisperMessageFile {
	name: string;
	mime: string;
	size: number;
	dataBase64?: string;
	blobUrl?: string;
	thumbUrl?: string;
	type?: 'file' | 'voice' | 'video';
	duration?: number;
	waveform?: number[];
}

export interface WhisperMessageItem {
	id: string;
	sessionId: string;
	senderId: string;
	text?: string;
	file?: WhisperMessageFile;
	sentAt: number;
	expiresAt: number | null;
}

export interface ActiveWhisperSession {
	sessionId: string;
	peerId: string;
	peerUsername: string;
	sessionKey: CryptoKey;
	expiryMode: WhisperExpiryMode;
	safetyNumber: string;
	fingerprintHex: string;
	verified: boolean;
	initiatedByMe: boolean;
	messages: WhisperMessageItem[];
	status: 'active' | 'closed' | 'burned';
	statusMessage?: string;
	createdAt: number;
}

export interface IncomingWhisperInvite {
	sessionId: string;
	initiatorId: string;
	initiatorUsername: string;
	pubKey: string;
	expiryMode: WhisperExpiryMode;
}

interface WhisperState {
	activeSession: ActiveWhisperSession | null;
	incomingInvite: IncomingWhisperInvite | null;
	isWhisperModeActive: boolean;
	whisperPeerId: string | null;
	isStartModalOpen: boolean;
	isSafetyNumberModalOpen: boolean;
	startModalPeer: { id: string; username: string } | null;
	isConnecting: boolean;
	errorMessage: string | null;

	// In-place mode controls
	enterWhisperMode: (peerId: string) => void;
	exitWhisperMode: () => void;

	// UI Modals
	openStartModal: (peerId: string, peerUsername: string) => void;
	closeStartModal: () => void;
	openSafetyNumberModal: () => void;
	closeSafetyNumberModal: () => void;
	dismissInvite: () => void;
	clearError: () => void;

	// Core actions
	initiateWhisper: (peerId: string, peerUsername: string, expiryMode: WhisperExpiryMode) => Promise<void>;
	acceptInvite: (invite: IncomingWhisperInvite) => Promise<void>;
	rejectInvite: (sessionId: string) => void;
	sendMessage: (text: string) => Promise<void>;
	sendFile: (file: File) => Promise<void>;
	sendVoiceMessage: (file: File, duration?: number, waveform?: number[]) => Promise<void>;
	sendVideoMessage: (file: File, duration?: number) => Promise<void>;
	toggleVerified: () => Promise<void>;
	closeSession: () => void;
	burnSession: () => Promise<void>;
	loadSessionForPeer: (peerId: string, peerUsername: string) => Promise<boolean>;
}

// In-memory registry for pending ephemeral private keys during handshake
const pendingPrivateKeys = new Map<string, CryptoKey>();

let wsListenersAttached = false;
let expiryInterval: any = null;

export const useWhisperStore = create<WhisperState>((set, get) => {
	// Setup periodic expiry sweep (every 3 seconds)
	if (typeof window !== 'undefined' && !expiryInterval) {
		expiryInterval = setInterval(async () => {
			const { activeSession } = get();
			const now = Date.now();

			// 1. Purge from DB
			await whisperDb.purgeExpiredMessages().catch(() => {});

			// 2. Filter active RAM messages if any expired
			if (activeSession && activeSession.messages.some((m) => m.expiresAt !== null && m.expiresAt <= now)) {
				// Revoke blob URLs for expired files
				for (const m of activeSession.messages) {
					if (m.expiresAt !== null && m.expiresAt <= now && m.file?.blobUrl) {
						URL.revokeObjectURL(m.file.blobUrl);
					}
				}

				set({
					activeSession: {
						...activeSession,
						messages: activeSession.messages.filter(
							(m) => m.expiresAt === null || m.expiresAt > now,
						),
					},
				});
			}
		}, 3000);
	}

	return {
		activeSession: null,
		incomingInvite: null,
		isWhisperModeActive: false,
		whisperPeerId: null,
		isStartModalOpen: false,
		isSafetyNumberModalOpen: false,
		startModalPeer: null,
		isConnecting: false,
		errorMessage: null,

		enterWhisperMode: (peerId) => {
			set({ isWhisperModeActive: true, whisperPeerId: peerId });
		},

		exitWhisperMode: () => {
			set({ isWhisperModeActive: false });
		},

		openStartModal: (peerId, peerUsername) => {
			set({
				isStartModalOpen: true,
				startModalPeer: { id: peerId, username: peerUsername },
				errorMessage: null,
			});
		},

		closeStartModal: () => set({ isStartModalOpen: false, startModalPeer: null }),
		openSafetyNumberModal: () => set({ isSafetyNumberModalOpen: true }),
		closeSafetyNumberModal: () => set({ isSafetyNumberModalOpen: false }),
		dismissInvite: () => set({ incomingInvite: null }),
		clearError: () => set({ errorMessage: null }),

		initiateWhisper: async (peerId, peerUsername, expiryMode) => {
			const currentUser = useAuthStore.getState().user;
			if (!currentUser) return;

			set({ isConnecting: true, errorMessage: null });

			try {
				const sessionId = 'whisper-' + crypto.randomUUID();
				const keypair = await generateWhisperKeypair();
				pendingPrivateKeys.set(sessionId, keypair.privateKey);

				const pubBytes = await exportPublicKey(keypair.publicKey);
				const pubKeyBase64 = uint8ArrayToBase64(pubBytes);

				wsSendWhisperInit(sessionId, peerId, pubKeyBase64, expiryMode);

				// Prepare placeholder active session and switch to in-place Whisper Mode
				set({
					isStartModalOpen: false,
					startModalPeer: null,
					isWhisperModeActive: true,
					whisperPeerId: peerId,
					activeSession: {
						sessionId,
						peerId,
						peerUsername,
						sessionKey: null as any,
						expiryMode,
						safetyNumber: '',
						fingerprintHex: '',
						verified: false,
						initiatedByMe: true,
						messages: [],
						status: 'active',
						statusMessage: 'Waiting for ' + peerUsername + ' to accept...',
						createdAt: Date.now(),
					},
				});
			} catch (err: any) {
				set({
					isConnecting: false,
					errorMessage: err.message || 'Failed to initiate Whisper session',
				});
			}
		},

		acceptInvite: async (invite) => {
			const currentUser = useAuthStore.getState().user;
			if (!currentUser) return;

			set({ isConnecting: true, incomingInvite: null, errorMessage: null });

			try {
				const keypair = await generateWhisperKeypair();
				const remotePubBytes = base64ToUint8Array(invite.pubKey);
				const remotePubKey = await importPublicKey(remotePubBytes);

				const secrets = await deriveWhisperSecrets(
					keypair.privateKey,
					remotePubKey,
					invite.sessionId,
					currentUser.id,
					invite.initiatorId,
				);

				const pubBytes = await exportPublicKey(keypair.publicKey);
				const pubKeyBase64 = uint8ArrayToBase64(pubBytes);

				wsSendWhisperAccept(invite.sessionId, pubKeyBase64);

				if (invite.expiryMode !== 'session_only') {
					await whisperDb.saveSession({
						sessionId: invite.sessionId,
						peerId: invite.initiatorId,
						peerUsername: invite.initiatorUsername,
						sessionKey: secrets.sessionKey,
						expiryMode: invite.expiryMode,
						safetyNumber: secrets.safetyNumber,
						fingerprintHex: secrets.fingerprintHex,
						verified: false,
						createdAt: Date.now(),
						lastActivity: Date.now(),
					}, secrets.wrappedSessionKey);
				}

				// Find and select the DM channel for this peer if not already active
				const channels = useChannelStore.getState().channels;
				const dmChannel = channels.find((c) =>
					c.members?.includes(invite.initiatorId) && c.members?.length === 2,
				);
				if (dmChannel) {
					useChannelStore.getState().setActiveChannel(dmChannel);
				}

				set({
					isConnecting: false,
					isWhisperModeActive: true,
					whisperPeerId: invite.initiatorId,
					activeSession: {
						sessionId: invite.sessionId,
						peerId: invite.initiatorId,
						peerUsername: invite.initiatorUsername,
						sessionKey: secrets.sessionKey,
						expiryMode: invite.expiryMode,
						safetyNumber: secrets.safetyNumber,
						fingerprintHex: secrets.fingerprintHex,
						verified: false,
						initiatedByMe: false,
						messages: [],
						status: 'active',
						createdAt: Date.now(),
					},
				});
			} catch (err: any) {
				set({
					isConnecting: false,
					errorMessage: err.message || 'Failed to establish encrypted session',
				});
			}
		},

		rejectInvite: (sessionId) => {
			wsSendWhisperReject(sessionId, 'declined');
			set({ incomingInvite: null });
		},

		sendMessage: async (text) => {
			const { activeSession } = get();
			const currentUser = useAuthStore.getState().user;
			if (!activeSession || !activeSession.sessionKey || !currentUser) return;

			const now = Date.now();
			let expiresAt: number | null = null;
			if (activeSession.expiryMode === '5m') {
				expiresAt = now + 5 * 60 * 1000;
			} else if (activeSession.expiryMode === '1h') {
				expiresAt = now + 60 * 60 * 1000;
			} else if (activeSession.expiryMode === '24h') {
				expiresAt = now + 24 * 60 * 60 * 1000;
			}

			const payload: WhisperPayloadData = { text };
			const encrypted = await whisperEncryptPayload(activeSession.sessionKey, payload);
			const ciphertextBase64 = uint8ArrayToBase64(encrypted.ciphertext);
			const nonceBase64 = uint8ArrayToBase64(encrypted.nonce);

			wsSendWhisperMsg(activeSession.sessionId, ciphertextBase64, nonceBase64, expiresAt);

			const msgId = crypto.randomUUID();
			const newMsg: WhisperMessageItem = {
				id: msgId,
				sessionId: activeSession.sessionId,
				senderId: currentUser.id,
				text,
				sentAt: now,
				expiresAt,
			};

			if (activeSession.expiryMode !== 'session_only') {
				await whisperDb.saveMessage({
					id: msgId,
					sessionId: activeSession.sessionId,
					senderId: currentUser.id,
					ciphertext: encrypted.ciphertext,
					nonce: encrypted.nonce,
					sentAt: now,
					expiresAt,
				});
			}

			set({
				activeSession: {
					...activeSession,
					messages: [...activeSession.messages, newMsg],
				},
			});
		},

		sendFile: async (file: File) => {
			const { activeSession } = get();
			const currentUser = useAuthStore.getState().user;
			if (!activeSession || !activeSession.sessionKey || !currentUser) return;

			const now = Date.now();
			let expiresAt: number | null = null;
			if (activeSession.expiryMode === '5m') {
				expiresAt = now + 5 * 60 * 1000;
			} else if (activeSession.expiryMode === '1h') {
				expiresAt = now + 60 * 60 * 1000;
			} else if (activeSession.expiryMode === '24h') {
				expiresAt = now + 24 * 60 * 60 * 1000;
			}

			const dataBase64 = await fileToBase64(file);
			const blobUrl = URL.createObjectURL(file);

			const payload: WhisperPayloadData = {
				file: {
					name: file.name,
					mime: file.type || 'application/octet-stream',
					size: file.size,
					dataBase64,
				},
			};

			const encrypted = await whisperEncryptPayload(activeSession.sessionKey, payload);
			const ciphertextBase64 = uint8ArrayToBase64(encrypted.ciphertext);
			const nonceBase64 = uint8ArrayToBase64(encrypted.nonce);

			wsSendWhisperMsg(activeSession.sessionId, ciphertextBase64, nonceBase64, expiresAt);

			const msgId = crypto.randomUUID();
			const newMsg: WhisperMessageItem = {
				id: msgId,
				sessionId: activeSession.sessionId,
				senderId: currentUser.id,
				file: {
					name: file.name,
					mime: file.type || 'application/octet-stream',
					size: file.size,
					dataBase64,
					blobUrl,
				},
				sentAt: now,
				expiresAt,
			};

			if (activeSession.expiryMode !== 'session_only') {
				await whisperDb.saveMessage({
					id: msgId,
					sessionId: activeSession.sessionId,
					senderId: currentUser.id,
					ciphertext: encrypted.ciphertext,
					nonce: encrypted.nonce,
					sentAt: now,
					expiresAt,
				});
			}

			set({
				activeSession: {
					...activeSession,
					messages: [...activeSession.messages, newMsg],
				},
			});
		},

		sendVoiceMessage: async (file: File, duration?: number, waveform?: number[]) => {
			const { activeSession } = get();
			const currentUser = useAuthStore.getState().user;
			if (!activeSession || !activeSession.sessionKey || !currentUser) return;

			const now = Date.now();
			let expiresAt: number | null = null;
			if (activeSession.expiryMode === '5m') {
				expiresAt = now + 5 * 60 * 1000;
			} else if (activeSession.expiryMode === '1h') {
				expiresAt = now + 60 * 60 * 1000;
			} else if (activeSession.expiryMode === '24h') {
				expiresAt = now + 24 * 60 * 60 * 1000;
			}

			const dataBase64 = await fileToBase64(file);
			const blobUrl = URL.createObjectURL(file);

			const payload: WhisperPayloadData = {
				file: {
					name: file.name || 'voice-message.ogg',
					mime: file.type || 'audio/ogg',
					size: file.size,
					dataBase64,
					type: 'voice',
					duration,
					waveform,
				},
			};

			const encrypted = await whisperEncryptPayload(activeSession.sessionKey, payload);
			const ciphertextBase64 = uint8ArrayToBase64(encrypted.ciphertext);
			const nonceBase64 = uint8ArrayToBase64(encrypted.nonce);

			wsSendWhisperMsg(activeSession.sessionId, ciphertextBase64, nonceBase64, expiresAt);

			const msgId = crypto.randomUUID();
			const newMsg: WhisperMessageItem = {
				id: msgId,
				sessionId: activeSession.sessionId,
				senderId: currentUser.id,
				file: {
					name: file.name || 'voice-message.ogg',
					mime: file.type || 'audio/ogg',
					size: file.size,
					dataBase64,
					blobUrl,
					type: 'voice',
					duration,
					waveform,
				},
				sentAt: now,
				expiresAt,
			};

			if (activeSession.expiryMode !== 'session_only') {
				await whisperDb.saveMessage({
					id: msgId,
					sessionId: activeSession.sessionId,
					senderId: currentUser.id,
					ciphertext: encrypted.ciphertext,
					nonce: encrypted.nonce,
					sentAt: now,
					expiresAt,
				});
			}

			set({
				activeSession: {
					...activeSession,
					messages: [...activeSession.messages, newMsg],
				},
			});
		},

		sendVideoMessage: async (file: File, duration?: number) => {
			const { activeSession } = get();
			const currentUser = useAuthStore.getState().user;
			if (!activeSession || !activeSession.sessionKey || !currentUser) return;

			const now = Date.now();
			let expiresAt: number | null = null;
			if (activeSession.expiryMode === '5m') {
				expiresAt = now + 5 * 60 * 1000;
			} else if (activeSession.expiryMode === '1h') {
				expiresAt = now + 60 * 60 * 1000;
			} else if (activeSession.expiryMode === '24h') {
				expiresAt = now + 24 * 60 * 60 * 1000;
			}

			const dataBase64 = await fileToBase64(file);
			const blobUrl = URL.createObjectURL(file);

			const payload: WhisperPayloadData = {
				file: {
					name: file.name || 'video-message.webm',
					mime: file.type || 'video/webm',
					size: file.size,
					dataBase64,
					type: 'video',
					duration,
				},
			};

			const encrypted = await whisperEncryptPayload(activeSession.sessionKey, payload);
			const ciphertextBase64 = uint8ArrayToBase64(encrypted.ciphertext);
			const nonceBase64 = uint8ArrayToBase64(encrypted.nonce);

			wsSendWhisperMsg(activeSession.sessionId, ciphertextBase64, nonceBase64, expiresAt);

			const msgId = crypto.randomUUID();
			const newMsg: WhisperMessageItem = {
				id: msgId,
				sessionId: activeSession.sessionId,
				senderId: currentUser.id,
				file: {
					name: file.name || 'video-message.webm',
					mime: file.type || 'video/webm',
					size: file.size,
					dataBase64,
					blobUrl,
					type: 'video',
					duration,
				},
				sentAt: now,
				expiresAt,
			};

			if (activeSession.expiryMode !== 'session_only') {
				await whisperDb.saveMessage({
					id: msgId,
					sessionId: activeSession.sessionId,
					senderId: currentUser.id,
					ciphertext: encrypted.ciphertext,
					nonce: encrypted.nonce,
					sentAt: now,
					expiresAt,
				});
			}

			set({
				activeSession: {
					...activeSession,
					messages: [...activeSession.messages, newMsg],
				},
			});
		},

		toggleVerified: async () => {
			const { activeSession } = get();
			if (!activeSession) return;

			const newVerified = !activeSession.verified;
			if (activeSession.expiryMode !== 'session_only') {
				await whisperDb.setSessionVerified(activeSession.sessionId, newVerified);
			}

			set({
				activeSession: {
					...activeSession,
					verified: newVerified,
				},
			});
		},

		closeSession: () => {
			const { activeSession } = get();
			if (!activeSession) {
				set({ isWhisperModeActive: false });
				return;
			}

			// Covers the initiator canceling while still waiting on a response —
			// otherwise this session's ephemeral private key sits in the pending
			// map forever, since it's normally only cleared by whisper_accept.
			pendingPrivateKeys.delete(activeSession.sessionId);

			wsSendWhisperClose(activeSession.sessionId, 'closed');

			if (activeSession.expiryMode === 'session_only') {
				// Clean up any blob URLs
				for (const m of activeSession.messages) {
					if (m.file?.blobUrl) URL.revokeObjectURL(m.file.blobUrl);
				}
				set({ activeSession: null, isWhisperModeActive: false });
			} else {
				set({
					isWhisperModeActive: false,
					activeSession: {
						...activeSession,
						status: 'closed',
						statusMessage: 'Session closed.',
					},
				});
			}
		},

		burnSession: async () => {
			const { activeSession } = get();
			if (!activeSession) {
				set({ isWhisperModeActive: false });
				return;
			}

			pendingPrivateKeys.delete(activeSession.sessionId);

			wsSendWhisperClose(activeSession.sessionId, 'burned');

			// Clean up blob URLs
			for (const m of activeSession.messages) {
				if (m.file?.blobUrl) URL.revokeObjectURL(m.file.blobUrl);
			}

			await whisperDb.deleteSession(activeSession.sessionId);

			set({
				activeSession: null,
				isWhisperModeActive: false,
				isSafetyNumberModalOpen: false,
			});
		},

		loadSessionForPeer: async (peerId, peerUsername) => {
			try {
				const storedSession = await whisperDb.getSessionByPeerId(peerId);
				if (!storedSession) return false;

				// Revoke blob URLs from whatever session is currently loaded — it's
				// about to be replaced with freshly-decrypted messages (with brand
				// new blob URLs) below. Without this, reopening the same Whisper DM
				// repeatedly re-allocates object URLs for the same attachments each
				// time without ever freeing the previous batch.
				const { activeSession: prevSession } = get();
				if (prevSession) {
					for (const m of prevSession.messages) {
						if (m.file?.blobUrl) URL.revokeObjectURL(m.file.blobUrl);
					}
				}

				const storedMsgs = await whisperDb.getMessages(storedSession.sessionId);
				const decryptedMsgs: WhisperMessageItem[] = [];

				for (const m of storedMsgs) {
					try {
						const payload = await whisperDecryptPayload(
							storedSession.sessionKey,
							m.ciphertext,
							m.nonce,
						);

						let fileMeta: WhisperMessageFile | undefined = undefined;
						if (payload.file) {
							fileMeta = {
								name: payload.file.name,
								mime: payload.file.mime,
								size: payload.file.size,
								dataBase64: payload.file.dataBase64,
								type: payload.file.type || (payload.file.mime.startsWith('audio/') ? 'voice' : payload.file.mime.startsWith('video/') ? 'video' : 'file'),
								duration: payload.file.duration,
								waveform: payload.file.waveform,
								blobUrl: payload.file.dataBase64
									? base64ToBlobUrl(payload.file.dataBase64, payload.file.mime)
									: undefined,
							};
						}

						decryptedMsgs.push({
							id: m.id,
							sessionId: m.sessionId,
							senderId: m.senderId,
							text: payload.text,
							file: fileMeta,
							sentAt: m.sentAt,
							expiresAt: m.expiresAt,
						});
					} catch (e) {
						console.warn('[whisper] failed to decrypt cached message', e);
					}
				}

				set({
					activeSession: {
						sessionId: storedSession.sessionId,
						peerId: storedSession.peerId,
						peerUsername: storedSession.peerUsername || peerUsername,
						sessionKey: storedSession.sessionKey,
						expiryMode: storedSession.expiryMode,
						safetyNumber: storedSession.safetyNumber,
						fingerprintHex: storedSession.fingerprintHex,
						verified: storedSession.verified,
						initiatedByMe: false,
						messages: decryptedMsgs,
						status: 'active',
						createdAt: storedSession.createdAt,
					},
					isWhisperModeActive: true,
					whisperPeerId: peerId,
				});
				return true;
			} catch (e) {
				console.warn('[whisper] error loading persisted session', e);
				return false;
			}
		},
	};
});

// Attach global WebSocket event listeners
export function initWhisperListeners() {
	if (wsListenersAttached || typeof window === 'undefined') return;
	wsListenersAttached = true;

	// Inbound whisper_init (incoming invite)
	onWS('whisper_init', (raw: any) => {
		const currentUser = useAuthStore.getState().user;
		if (!currentUser || raw.initiator_id === currentUser.id) return;

		useWhisperStore.setState({
			incomingInvite: {
				sessionId: raw.session_id,
				initiatorId: raw.initiator_id,
				initiatorUsername: raw.initiator_username || 'Friend',
				pubKey: raw.pub_key,
				expiryMode: raw.expiry_mode || 'persistent',
			},
		});
	});

	// Inbound whisper_accept (responder accepted our session)
	onWS('whisper_accept', async (raw: any) => {
		const currentUser = useAuthStore.getState().user;
		const { activeSession } = useWhisperStore.getState();
		if (!currentUser || !activeSession || activeSession.sessionId !== raw.session_id) return;

		const localPriv = pendingPrivateKeys.get(raw.session_id);
		if (!localPriv) return;
		pendingPrivateKeys.delete(raw.session_id);

		try {
			const remotePubBytes = base64ToUint8Array(raw.pub_key);
			const remotePubKey = await importPublicKey(remotePubBytes);

			const secrets = await deriveWhisperSecrets(
				localPriv,
				remotePubKey,
				raw.session_id,
				currentUser.id,
				raw.target_id,
			);

			if (raw.expiry_mode !== 'session_only') {
				await whisperDb.saveSession({
					sessionId: raw.session_id,
					peerId: raw.target_id,
					peerUsername: raw.target_username || activeSession.peerUsername,
					sessionKey: secrets.sessionKey,
					expiryMode: raw.expiry_mode || 'persistent',
					safetyNumber: secrets.safetyNumber,
					fingerprintHex: secrets.fingerprintHex,
					verified: false,
					createdAt: Date.now(),
					lastActivity: Date.now(),
				}, secrets.wrappedSessionKey);
			}

			useWhisperStore.setState({
				isConnecting: false,
				isWhisperModeActive: true,
				whisperPeerId: raw.target_id,
				activeSession: {
					...activeSession,
					sessionKey: secrets.sessionKey,
					safetyNumber: secrets.safetyNumber,
					fingerprintHex: secrets.fingerprintHex,
					status: 'active',
					statusMessage: undefined,
				},
			});
		} catch (err: any) {
			useWhisperStore.setState({
				isConnecting: false,
				errorMessage: 'Cryptographic handshake derivation failed: ' + err.message,
			});
		}
	});

	// Inbound whisper_reject
	onWS('whisper_reject', (raw: any) => {
		// The initiator's ephemeral private key was only ever cleared on
		// whisper_accept — a decline leaves it in pendingPrivateKeys forever
		// otherwise.
		pendingPrivateKeys.delete(raw.session_id);

		const { activeSession } = useWhisperStore.getState();
		if (activeSession && activeSession.sessionId === raw.session_id) {
			useWhisperStore.setState({
				isConnecting: false,
				activeSession: {
					...activeSession,
					status: 'closed',
					statusMessage: 'Session was declined by peer.',
				},
			});
		}
	});

	// Inbound whisper_msg (encrypted message or file from peer)
	onWS('whisper_msg', async (raw: any) => {
		const { activeSession } = useWhisperStore.getState();
		if (!activeSession || activeSession.sessionId !== raw.session_id || !activeSession.sessionKey) return;

		try {
			const ciphertext = base64ToUint8Array(raw.ciphertext);
			const nonce = base64ToUint8Array(raw.nonce);
			const payload = await whisperDecryptPayload(activeSession.sessionKey, ciphertext, nonce);

			const msgId = crypto.randomUUID();
			let fileMeta: WhisperMessageFile | undefined = undefined;

			if (payload.file) {
				fileMeta = {
					name: payload.file.name,
					mime: payload.file.mime,
					size: payload.file.size,
					dataBase64: payload.file.dataBase64,
					type: payload.file.type || (payload.file.mime.startsWith('audio/') ? 'voice' : payload.file.mime.startsWith('video/') ? 'video' : 'file'),
					duration: payload.file.duration,
					waveform: payload.file.waveform,
					blobUrl: payload.file.dataBase64
						? base64ToBlobUrl(payload.file.dataBase64, payload.file.mime)
						: undefined,
				};
			}

			const newMsg: WhisperMessageItem = {
				id: msgId,
				sessionId: raw.session_id,
				senderId: raw.sender_id,
				text: payload.text,
				file: fileMeta,
				sentAt: raw.sent_at || Date.now(),
				expiresAt: raw.expires_at || null,
			};

			if (activeSession.expiryMode !== 'session_only') {
				await whisperDb.saveMessage({
					id: msgId,
					sessionId: raw.session_id,
					senderId: raw.sender_id,
					ciphertext,
					nonce,
					sentAt: newMsg.sentAt,
					expiresAt: newMsg.expiresAt,
				});
			}

			useWhisperStore.setState({
				activeSession: {
					...activeSession,
					messages: [...activeSession.messages, newMsg],
				},
			});
		} catch (e) {
			console.warn('[whisper] failed to decrypt inbound message', e);
		}
	});

	// Inbound whisper_close
	onWS('whisper_close', async (raw: any) => {
		// Covers a peer disconnecting/closing before we ever got their accept —
		// our ephemeral private key would otherwise leak in pendingPrivateKeys.
		pendingPrivateKeys.delete(raw.session_id);

		const { activeSession } = useWhisperStore.getState();
		if (!activeSession || activeSession.sessionId !== raw.session_id) return;

		if (raw.reason === 'burned') {
			for (const m of activeSession.messages) {
				if (m.file?.blobUrl) URL.revokeObjectURL(m.file.blobUrl);
			}
			await whisperDb.deleteSession(raw.session_id);
			useWhisperStore.setState({
				activeSession: {
					...activeSession,
					status: 'burned',
					statusMessage: 'This chat was burned and all data destroyed.',
					messages: [],
				},
			});
		} else {
			useWhisperStore.setState({
				activeSession: {
					...activeSession,
					status: 'closed',
					statusMessage:
						raw.reason === 'peer_disconnected'
							? 'Peer disconnected.'
							: 'Session was closed by peer.',
				},
			});
		}
	});

	// Inbound whisper_error
	onWS('whisper_error', (raw: any) => {
		// A session-scoped error (e.g. the backend tore the session down
		// server-side because relaying the accept failed — the initiator had
		// gone offline) means the session is dead even if this client had
		// already optimistically marked it 'active'. Without this, the UI kept
		// showing a seemingly-live encrypted chat the server had already
		// discarded, and every subsequent send would silently vanish.
		pendingPrivateKeys.delete(raw.session_id);

		const { activeSession } = useWhisperStore.getState();
		if (activeSession && raw.session_id && activeSession.sessionId === raw.session_id) {
			useWhisperStore.setState({
				isConnecting: false,
				errorMessage: raw.error || 'Whisper connection error',
				activeSession: {
					...activeSession,
					status: 'closed',
					statusMessage: raw.error || 'Session closed due to an error.',
				},
			});
			return;
		}

		useWhisperStore.setState({
			isConnecting: false,
			errorMessage: raw.error || 'Whisper connection error',
		});
	});
}
