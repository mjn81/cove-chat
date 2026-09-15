// Shared WebSocket lifecycle logic: connect, heartbeat, and backoff
// reconnect. Used by both the SharedWorker (src/ws/shared.worker.ts, for
// browsers that support it) and the direct-connection fallback (src/ws.ts,
// used by the Wails desktop app and browsers without SharedWorker support).
//
// These two paths used to duplicate this logic independently and had drifted
// out of sync — the direct-connection path was missing an `onerror` handler
// entirely, so on the desktop app (which always uses it) a TLS/DNS/refused
// connection produced no diagnostic signal beyond a generic close code.
// Fixing it in one place keeps both paths behaviorally identical.

export interface SocketManagerCallbacks {
	onOpen: () => void;
	onMessage: (raw: string) => void;
	onClose: (code: number) => void;
	onError: (err: unknown) => void;
}

export interface SocketManager {
	connect: (url?: string) => void;
	disconnect: () => void;
	send: (payload: unknown) => void;
	isOpen: () => boolean;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

export function createSocketManager(callbacks: SocketManagerCallbacks): SocketManager {
	let socket: WebSocket | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
	let lastUrl = '';
	let disconnected = false;

	function stopHeartbeat() {
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}

	function startHeartbeat() {
		stopHeartbeat();
		heartbeatTimer = setInterval(() => {
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: 'ping', payload: null }));
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	function scheduleReconnect() {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(() => {
			reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
			connect(lastUrl);
		}, reconnectDelay);
	}

	function connect(url?: string) {
		disconnected = false;

		if (socket) {
			if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
				if (!url || url === lastUrl) return;
				// URL changed (e.g. new token) — close the old one and start fresh.
				socket.close(1000, 'URL changed');
			}
		}

		lastUrl = url || lastUrl;
		socket = new WebSocket(lastUrl);

		socket.onopen = () => {
			reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
			callbacks.onOpen();
			startHeartbeat();
		};

		socket.onmessage = (event) => {
			callbacks.onMessage(event.data);
		};

		socket.onclose = (ev) => {
			stopHeartbeat();
			callbacks.onClose(ev.code);

			if (disconnected || ev.code === 1000 || ev.code === 1001) {
				return;
			}
			scheduleReconnect();
		};

		socket.onerror = (err) => {
			callbacks.onError(err);
		};
	}

	function disconnect() {
		disconnected = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		stopHeartbeat();
		socket?.close(1000, 'User logout');
		socket = null;
	}

	function send(payload: unknown) {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(payload));
		}
	}

	function isOpen(): boolean {
		return socket?.readyState === WebSocket.OPEN;
	}

	return { connect, disconnect, send, isOpen };
}
