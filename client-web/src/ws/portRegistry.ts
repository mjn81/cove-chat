// Tracks the MessagePorts of tabs connected to the WS SharedWorker.
//
// Extracted out of shared.worker.ts (which only runs inside a SharedWorker
// global scope, not reachable by jsdom-based unit tests) so the actual
// bookkeeping logic — the part that was leaking — can be tested directly.

export interface PortLike {
	postMessage(message: unknown): void;
}

export function createPortRegistry<T extends PortLike>() {
	const ports: T[] = [];

	return {
		add(port: T): void {
			ports.push(port);
		},
		// Removes a specific port, e.g. when its tab is closing. Without this,
		// every tab ever opened leaves a permanent entry for the life of the
		// SharedWorker (which outlives any single tab), and broadcasts keep
		// attempting to message closed tabs indefinitely.
		remove(port: T): void {
			const idx = ports.indexOf(port);
			if (idx !== -1) ports.splice(idx, 1);
		},
		all(): readonly T[] {
			return ports;
		},
		get size(): number {
			return ports.length;
		},
		// Delivers msg to every tracked port, dropping (and untracking) any
		// port whose postMessage throws instead of silently swallowing the
		// error and leaving the dead reference in place.
		broadcast(msg: unknown): void {
			for (const port of [...ports]) {
				try {
					port.postMessage(msg);
				} catch {
					this.remove(port);
				}
			}
		},
	};
}

export type PortRegistry<T extends PortLike = PortLike> = ReturnType<typeof createPortRegistry<T>>;
