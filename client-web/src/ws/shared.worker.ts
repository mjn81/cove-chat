// SharedWorker for managing a singleton WebSocket connection across multiple tabs.

/// <reference lib="webworker" />

import { createPortRegistry } from './portRegistry';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const portRegistry = createPortRegistry<MessagePort>();
let wsUrl: string = 'ws://localhost:8080/ws';

// Listen for connections from new tabs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _self: any = self;
_self.onconnect = (e: MessageEvent) => {
	const port = e.ports[0];
	portRegistry.add(port);

	port.onmessage = (ev) => {
		const { cmd, payload } = ev.data;

		switch (cmd) {
			case 'CONNECT': {
				wsUrl = payload.url;
				connect();
				break;
			}
			case 'DISCONNECT': {
				disconnect();
				break;
			}
			case 'SEND': {
				if (socket?.readyState === WebSocket.OPEN) {
					socket.send(JSON.stringify(payload));
				}
				break;
			}
			case 'LEAVE': {
				// This tab is closing/navigating away — stop tracking its port so
				// broadcasts don't keep targeting it and the registry doesn't grow
				// forever across the SharedWorker's lifetime (it outlives any
				// single tab).
				portRegistry.remove(port);
				break;
			}
		}
	};

	port.start();

	// Immediately inform the new port if we are already connected
	if (socket?.readyState === WebSocket.OPEN) {
		port.postMessage({ type: 'WS_OPEN' });
	}
};

function connect() {
	if (socket) {
		if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
			if (socket.url === wsUrl) return;
			// If URL changed (e.g. new token), close old and start new
			socket.close(1000, 'URL changed');
		}
	}

	console.info('[SharedWorker] connecting to', wsUrl);
	socket = new WebSocket(wsUrl);

	socket.onopen = () => {
		console.info('[SharedWorker] connected');
		reconnectDelay = 1000;
		broadcast({ type: 'WS_OPEN' });
		startHeartbeat();
	};

	socket.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data);
			broadcast({ type: 'WS_MESSAGE', payload: msg });
		} catch (e) {
			console.warn('[SharedWorker] unparseable message', e);
		}
	};

	socket.onclose = (ev) => {
		stopHeartbeat();
		broadcast({ type: 'WS_CLOSE', code: ev.code });
		
		if (ev.code === 1000 || ev.code === 1001) {
			console.info('[SharedWorker] closed normally');
			return;
		}

		console.warn(`[SharedWorker] closed (${ev.code}), reconnecting in ${reconnectDelay}ms...`);
		scheduleReconnect();
	};

	socket.onerror = (err) => {
		console.error('[SharedWorker] websocket error', err);
	};
}

function disconnect() {
	if (reconnectTimer) clearTimeout(reconnectTimer);
	stopHeartbeat();
	socket?.close(1000, 'User logout');
	socket = null;
}

function scheduleReconnect() {
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = setTimeout(() => {
		reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
		connect();
	}, reconnectDelay);
}

function startHeartbeat() {
	stopHeartbeat();
	heartbeatTimer = setInterval(() => {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'ping', payload: null }));
		}
	}, 25_000);
}

function stopHeartbeat() {
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	heartbeatTimer = null;
}

// Broadcasts an event to all connected UI tabs
function broadcast(msg: unknown) {
	portRegistry.broadcast(msg);
}
