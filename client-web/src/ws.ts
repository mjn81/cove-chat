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
	| 'voice_update'
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
	sendToWorker('CONNECT', { url: getFullWsUrl(token) });
}

function getFullWsUrl(explicitToken?: string): string {
	// Web client: the session travels via the httpOnly cookie automatically
	// included in the WS handshake — no token needed in the URL.
	if (!isWails()) {
		return `${getWsUrl()}/ws`;
	}

	// Desktop (Wails) client: its webview doesn't reliably persist httpOnly
	// cookies, so continue authenticating via a token in the URL.
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

	const url = `${getWsUrl()}/ws${token ? `?token=${token}` : ''}`;
	console.info('[ws] connecting to:', url.replace(token, '***'));
	return url;
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
				if (cmd === 'CONNECT') socketManager.connect(payload?.url ?? getFullWsUrl());
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
		case 'voice_update':
			emit('voice_update', msg.payload);
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
	type: 'text' | 'file' | 'voice' = 'text',
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
export async function decryptMessage(msg: Message): Promise<string> {
	const key = useCryptoStore.getState().channelKeys.get(msg.channel_id);
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
		const nonce = base64ToBytes(msg.nonce);
		const ct = base64ToBytes(msg.ciphertext);
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: nonce as any },
			cryptoKey,
			ct as any,
		);
		return new TextDecoder().decode(decrypted);
	} catch {
		return '[decryption failed]';
	}
}
