// SharedWorker for managing a singleton WebSocket connection across multiple tabs.

/// <reference lib="webworker" />

import { createPortRegistry } from './portRegistry';
import { createSocketManager } from './socketManager';

const portRegistry = createPortRegistry<MessagePort>();

const socketManager = createSocketManager({
	onOpen: () => {
		console.info('[SharedWorker] connected');
		broadcast({ type: 'WS_OPEN' });
	},
	onMessage: (raw) => {
		try {
			const msg = JSON.parse(raw);
			broadcast({ type: 'WS_MESSAGE', payload: msg });
		} catch (e) {
			console.warn('[SharedWorker] unparseable message', e);
		}
	},
	onClose: (code) => {
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

// Listen for connections from new tabs.
const _self: any = self;
_self.onconnect = (e: MessageEvent) => {
	const port = e.ports[0];
	portRegistry.add(port);

	port.onmessage = (ev) => {
		const { cmd, payload } = ev.data;

		switch (cmd) {
			case 'CONNECT': {
				socketManager.connect(payload.url);
				break;
			}
			case 'DISCONNECT': {
				socketManager.disconnect();
				break;
			}
			case 'SEND': {
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

	// Immediately inform the new port if we are already connected, so a tab
	// opened after the connection was established doesn't wait silently.
	if (socketManager.isOpen()) {
		port.postMessage({ type: 'WS_OPEN' });
	}
};

// Broadcasts an event to all connected UI tabs
function broadcast(msg: unknown) {
	portRegistry.broadcast(msg);
}
