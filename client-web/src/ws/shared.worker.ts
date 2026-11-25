// SharedWorker for managing a singleton WebSocket connection across multiple tabs.

/// <reference lib="webworker" />

import { createPortRegistry } from './portRegistry';
import { createReplayCache } from './replayCache';
import { createSocketManager } from './socketManager';

const portRegistry = createPortRegistry<MessagePort>();

// What a tab joining the already open socket would otherwise miss (see replayCache.ts).
const replayCache = createReplayCache();

const socketManager = createSocketManager({
	onOpen: () => {
		console.info('[SharedWorker] connected');
		broadcast({ type: 'WS_OPEN' });
	},
	onMessage: (raw) => {
		try {
			const msg = JSON.parse(raw);
			replayCache.inbound(msg);
			broadcast({ type: 'WS_MESSAGE', payload: msg });
		} catch (e) {
			console.warn('[SharedWorker] unparseable message', e);
		}
	},
	onClose: (code) => {
		replayCache.clear();
		broadcast({ type: 'WS_CLOSE', code });
		if (code === 1000 || code === 1001) {
			console.info('[SharedWorker] closed normally');
		} else {
			console.warn(`[SharedWorker] closed (${code}), reconnecting...`);
		}
	},
	onError: (err) => {
		console.error('[SharedWorker] websocket error', err);
	},
});

// Starts delivering events to a port and brings its tab up to date with the open socket.
function join(port: MessagePort) {
	portRegistry.add(port);

	// Immediately inform the port if we are already connected, so a tab
	// opened after the connection was established doesn't wait silently.
	if (socketManager.isOpen()) {
		port.postMessage({ type: 'WS_OPEN' });
	}
	for (const msg of replayCache.events()) {
		port.postMessage({ type: 'WS_MESSAGE', payload: msg });
	}
}

// Listen for connections from new tabs.
const _self: any = self;
_self.onconnect = (e: MessageEvent) => {
	const port = e.ports[0];

	port.onmessage = (ev) => {
		const { cmd, payload } = ev.data;

		switch (cmd) {
			case 'CONNECT': {
				// A tab restored from the back/forward cache sent LEAVE when it was hidden: take it back.
				if (!portRegistry.has(port)) join(port);
				socketManager.connect(payload.url, payload.protocols);
				break;
			}
			case 'DISCONNECT': {
				// Clear now: the socket's close event arrives later, and another tab may connect before it does.
				replayCache.clear();
				socketManager.disconnect();
				break;
			}
			case 'SEND': {
				replayCache.outbound(payload);
				socketManager.send(payload);
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
	join(port);
};

// Broadcasts an event to all connected UI tabs
function broadcast(msg: unknown) {
	portRegistry.broadcast(msg);
}
