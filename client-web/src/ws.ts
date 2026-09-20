// WebSocket client with auto-reconnect and channel key management

import type { Message } from '@/types/api';
import { isWails } from '@/utils/wails';
import { createSocketManager } from '@/ws/socketManager';

import { BASE_URL } from '@/api/client';

const getWsUrl = () => {
	// Derive WS URL from the current API BASE_URL
	// e.g. http://127.0.0.1:4000 -> ws://127.0.0.1:4000
	//      https://chat.example.com -> wss://chat.example.com
	const url = new URL(BASE_URL);
	const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${url.host}`;
};

// ── Binary Helpers ───────────────────────────────────────────────────────
export function base64ToBytes(base64: string): Uint8Array {
	const binString = atob(base64);
	return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

export function bytesToBase64(bytes: Uint8Array): string {
	// Correct way to handle potential stack issues with larger arrays
	const binString = Array.from(bytes, (byte) =>
		String.fromCodePoint(byte),
	).join('');
	return btoa(binString);
}

import { useCryptoStore } from '@/store/crypto.slice';

// ── Channel Key Registry ────────────────────────────────────────────────
// Keys are received from the server over WSS on connect and kept in memory.
// They are NEVER persisted to disk / localStorage.

export function getChannelKey(channelId: string): Uint8Array | undefined {
	return useCryptoStore.getState().channelKeys.get(channelId);
}

// ── Event Listeners ─────────────────────────────────────────────────────
type WSEventType =
	| 'message'
	| 'message_update'
	| 'message_delete'
	| 'presence'
	| 'channel_key'
	| 'channel_update'
	| 'channel_delete'
	| 'voice_update'
	| 'relationship_update'
	| 'video_ready'
	| 'whisper_init'
	| 'whisper_accept'
	| 'whisper_reject'
	| 'whisper_msg'
	| 'whisper_close'
	| 'whisper_error'
	| 'open'
	| 'close';
type WSListener = (payload: unknown) => void;

const listeners = new Map<WSEventType, Set<WSListener>>();

export function onWS(event: WSEventType, fn: WSListener): () => void {
	if (!listeners.has(event)) listeners.set(event, new Set());
	listeners.get(event)!.add(fn);
	return () => listeners.get(event)?.delete(fn);
}

function emit(event: WSEventType, payload: unknown) {
	listeners.get(event)?.forEach((fn) => fn(payload));
}

// ── WebSocket Connection Manager ────────────────────────────────────────
// Singleton state to manage either a SharedWorker or a direct connection
let worker: {
	port: {
		postMessage: (msg: any) => void;
		onmessage?: (e: any) => void;
		start: () => void;
	};
} | null = null;

let unloadListenerRegistered = false;

// Prefix for the WebSocket subprotocol used to carry the session token
// during the handshake (desktop/Wails client only — see getFullWsUrl).
// Must match the backend's wsAuthSubprotocolPrefix in internal/auth/auth.go.
const WS_TOKEN_SUBPROTOCOL_PREFIX = 'nodetalk-token.';

export function wsConnect(token?: string): void {
	if (!worker) {
		// SharedWorker is great for multiple tabs, but Wails/Safari often don't support it
		// or it's overkill for a single-window desktop app.
		if (typeof SharedWorker !== 'undefined' && !isWails()) {
			try {
				const sw = new SharedWorker(
					new URL('./ws/shared.worker.ts', import.meta.url),
					{
						type: 'module',
						name: 'nodetalk-ws',
					},
				);

				sw.port.onmessage = (event: MessageEvent) => {
					handleWorkerMessage(event.data);
				};
				sw.port.start();

				worker = {
					port: {
						postMessage: (msg) => sw.port.postMessage(msg),
						start: () => sw.port.start(),
					},
				};
				console.info('[ws] using SharedWorker');

				// Tell the worker to stop tracking this tab's port when it closes
				// or navigates away — without this the worker (which outlives any
				// single tab) keeps a permanent, never-removed reference to every
				// tab ever opened, and keeps trying to message the dead ones.
				if (!unloadListenerRegistered && typeof window !== 'undefined') {
					unloadListenerRegistered = true;
					window.addEventListener('pagehide', () => {
						sw.port.postMessage({ cmd: 'LEAVE', payload: null });
					});
				}
			} catch (err) {
				console.warn(
					'[ws] SharedWorker failed, falling back to direct connection',
					err,
				);
				setupDirectConnection();
			}
		} else {
			setupDirectConnection();
		}
	}

	// Trigger initial connection or update existing one with new token
	const { url, protocols } = getFullWsUrl(token);
	sendToWorker('CONNECT', { url, protocols });
}

function getFullWsUrl(explicitToken?: string): { url: string; protocols?: string[] } {
	const url = `${getWsUrl()}/ws`;

	// Web client: the session travels via the httpOnly cookie automatically
	// included in the WS handshake — no token needed at all.
	if (!isWails()) {
		return { url };
	}

	// Desktop (Wails) client: its webview doesn't reliably persist httpOnly
	// cookies, so it authenticates via a WebSocket subprotocol instead of a
	// URL query parameter — a token in the URL would leak into server
	// access logs, any intermediate proxy logs, and browser history.
	let token = explicitToken || '';
	if (!token) {
		try {
			token = localStorage.getItem('nodetalk_token') || '';
			if (token) {
				console.info('[ws] extracted token from localStorage');
			}
		} catch (err) {
			console.warn('[ws] failed to get token from localStorage', err);
		}
	}

	if (!token) return { url };

	// '=' padding isn't a legal character in an HTTP token / WS subprotocol
	// value, so it's stripped here and restored server-side.
	const protocols = [`${WS_TOKEN_SUBPROTOCOL_PREFIX}${token.replace(/=+$/, '')}`];
	console.info('[ws] connecting to:', url, 'with token subprotocol');
	return { url, protocols };
}

function setupDirectConnection() {
	console.info('[ws] using direct connection');

	const socketManager = createSocketManager({
		onOpen: () => {
			console.info('[ws-direct] connected');
			handleWorkerMessage({ type: 'WS_OPEN' });
		},
		onMessage: (raw) => {
			try {
				const msg = JSON.parse(raw);
				handleWorkerMessage({ type: 'WS_MESSAGE', payload: msg });
			} catch (e) {
				console.warn('[ws-direct] unparseable message', e);
			}
		},
		onClose: (code) => {
			handleWorkerMessage({ type: 'WS_CLOSE', code });
			if (code === 1000 || code === 1001) {
				console.info('[ws-direct] closed normally');
			} else {
				console.warn(`[ws-direct] closed (${code}), reconnecting...`);
			}
		},
		onError: (err) => {
			// Previously missing entirely on this path (used by the desktop app
			// and any browser without SharedWorker support) — connection errors
			// (TLS/DNS/refused) were silently absorbed into the eventual
			// onclose with no distinct diagnostic signal.
			console.error('[ws-direct] websocket error', err);
		},
	});

	worker = {
		port: {
			postMessage: (msg: any) => {
				const { cmd, payload } = msg;
				if (cmd === 'CONNECT') socketManager.connect(payload?.url ?? getFullWsUrl().url, payload?.protocols);
				else if (cmd === 'DISCONNECT') socketManager.disconnect();
				else if (cmd === 'SEND') socketManager.send(payload);
			},
			start: () => {},
		},
	};
}

function handleWorkerMessage(data: any) {
	const { type, payload, code } = data;
	if (type === 'WS_OPEN') {
		emit('open', null);
	} else if (type === 'WS_CLOSE') {
		emit('close', code);
	} else if (type === 'WS_MESSAGE') {
		handleInbound(payload as { type: string; payload: unknown });
	}
}

function sendToWorker(cmd: string, payload: any) {
	worker?.port.postMessage({ cmd, payload });
}

export function wsDisconnect(): void {
	sendToWorker('DISCONNECT', null);
	worker = null;
	useCryptoStore.getState().clearKeys();
}

// ── Inbound Handler ──────────────────────────────────────────────────────
function handleInbound(msg: { type: string; payload: unknown }) {
	switch (msg.type) {
		case 'channel_key': {
			const { channel_id, aes_key } = msg.payload as {
				channel_id: string;
				aes_key: string;
			};
			// Backend (Go) sends bytes as base64 strings
			useCryptoStore
				.getState()
				.setChannelKey(channel_id, base64ToBytes(aes_key));
			emit('channel_key', { channel_id });
			break;
		}
		case 'message':
			emit('message', msg.payload as Message);
			break;
		case 'message_update':
			emit('message_update', msg.payload as Message);
			break;
		case 'message_delete':
			emit(
				'message_delete',
				msg.payload as { channel_id: string; message_id: string },
			);
			break;
		case 'presence':
			emit('presence', msg.payload);
			break;
		case 'channel_update':
			emit('channel_update', msg.payload);
			break;
		case 'channel_delete':
			emit('channel_delete', msg.payload);
			break;
		case 'voice_update':
			emit('voice_update', msg.payload);
			break;
		case 'relationship_update':
			emit('relationship_update', msg.payload);
			break;
		case 'video_ready':
			emit('video_ready', msg.payload);
			break;
		case 'whisper_init':
			emit('whisper_init', msg.payload);
			break;
		case 'whisper_accept':
			emit('whisper_accept', msg.payload);
			break;
		case 'whisper_reject':
			emit('whisper_reject', msg.payload);
			break;
		case 'whisper_msg':
			emit('whisper_msg', msg.payload);
			break;
		case 'whisper_close':
			emit('whisper_close', msg.payload);
			break;
		case 'whisper_error':
			emit('whisper_error', msg.payload);
			break;
		default:
			console.debug('[ws-worker] unknown message type', msg.type);
	}
}

// ── Outbound Helpers ─────────────────────────────────────────────────────
function wsSend(msg: { type: string; payload: unknown }): boolean {
	if (!worker) return false;
	worker.port.postMessage({
		cmd: 'SEND',
		payload: msg,
	});
	return true;
}

export function wsSendWhisperInit(
	sessionId: string,
	targetUserId: string,
	pubKeyBase64: string,
	expiryMode: string,
): boolean {
	return wsSend({
		type: 'whisper_init',
		payload: {
			session_id: sessionId,
			target_user_id: targetUserId,
			pub_key: pubKeyBase64,
			expiry_mode: expiryMode,
		},
	});
}

export function wsSendWhisperAccept(
	sessionId: string,
	pubKeyBase64: string,
): boolean {
	return wsSend({
		type: 'whisper_accept',
		payload: {
			session_id: sessionId,
			pub_key: pubKeyBase64,
		},
	});
}

export function wsSendWhisperReject(
	sessionId: string,
	reason?: string,
): boolean {
	return wsSend({
		type: 'whisper_reject',
		payload: {
			session_id: sessionId,
			reason,
		},
	});
}

export function wsSendWhisperMsg(
	sessionId: string,
	ciphertextBase64: string,
	nonceBase64: string,
	expiresAt?: number | null,
): boolean {
	return wsSend({
		type: 'whisper_msg',
		payload: {
			session_id: sessionId,
			ciphertext: ciphertextBase64,
			nonce: nonceBase64,
			expires_at: expiresAt,
		},
	});
}

export function wsSendWhisperClose(
	sessionId: string,
	reason?: string,
): boolean {
	return wsSend({
		type: 'whisper_close',
		payload: {
			session_id: sessionId,
			reason: reason || 'closed',
		},
	});
}

export function wsSendReadReceipt(channelId: string) {
	wsSend({
		type: 'read_receipt',
		payload: { channel_id: channelId },
	});
}

/**
 * Sends an encrypted message payload. The client-side encryption is done here.
 * Currently ships the plaintext as a stub — full AES-256-GCM integration
 * to be wired in Phase 4 with the Web Crypto API.
 */
export async function wsSendMessage(
	channelId: string,
	text: string,
	type: 'text' | 'file' | 'voice' | 'video' = 'text',
	compression: string = 'none',
	replyToId?: string,
): Promise<boolean> {
	const key = useCryptoStore.getState().channelKeys.get(channelId);

	let ciphertext: Uint8Array;
	let nonce: Uint8Array;

	if (key) {
		// Full AES-256-GCM encryption using the Web Crypto API
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			key.buffer.slice(
				key.byteOffset,
				key.byteOffset + key.byteLength,
			) as ArrayBuffer,
			{ name: 'AES-GCM' },
			false,
			['encrypt'],
		);
		const encoded = new TextEncoder().encode(text);
		const encrypted = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			cryptoKey,
			encoded,
		);
		nonce = iv;
		ciphertext = new Uint8Array(encrypted);
	} else {
		// No key yet — encode as plaintext bytes (development fallback)
		console.warn('[ws] no channel key for', channelId, '— sending unencrypted');
		ciphertext = new TextEncoder().encode(text);
		nonce = new Uint8Array(12);
	}

	return wsSend({
		type: 'message',
		payload: {
			channel_id: channelId,
			type,
			ciphertext: bytesToBase64(ciphertext),
			nonce: bytesToBase64(nonce),
			compression,
			reply_to_id: replyToId,
		},
	});
}

export async function wsEditMessage(
	channelId: string,
	messageId: string,
	text: string,
): Promise<boolean> {
	const key = useCryptoStore.getState().channelKeys.get(channelId);
	if (!key) return false;

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key.buffer.slice(
			key.byteOffset,
			key.byteOffset + key.byteLength,
		) as ArrayBuffer,
		{ name: 'AES-GCM' },
		false,
		['encrypt'],
	);
	const encoded = new TextEncoder().encode(text);
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		cryptoKey,
		encoded,
	);

	return wsSend({
		type: 'message_edit',
		payload: {
			channel_id: channelId,
			message_id: messageId,
			ciphertext: bytesToBase64(new Uint8Array(encrypted)),
			nonce: bytesToBase64(iv),
		},
	});
}

export function wsDeleteMessage(channelId: string, messageId: string): boolean {
	return wsSend({
		type: 'message_delete',
		payload: {
			channel_id: channelId,
			message_id: messageId,
		},
	});
}

// ── Decryption Helper ────────────────────────────────────────────────────
export async function decryptText(
	channelId: string,
	ciphertext: string,
	nonce: string,
): Promise<string> {
	const key = useCryptoStore.getState().channelKeys.get(channelId);
	if (!key) return '[encrypted]';

	try {
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			key.buffer.slice(
				key.byteOffset,
				key.byteOffset + key.byteLength,
			) as ArrayBuffer,
			{ name: 'AES-GCM' },
			false,
			['decrypt'],
		);
		const iv = base64ToBytes(nonce);
		const ct = base64ToBytes(ciphertext);
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: iv as any },
			cryptoKey,
			ct as any,
		);
		return new TextDecoder().decode(decrypted);
	} catch {
		return '[decryption failed]';
	}
}

export async function decryptMessage(msg: Message): Promise<string> {
	return decryptText(msg.channel_id, msg.ciphertext, msg.nonce);
}
