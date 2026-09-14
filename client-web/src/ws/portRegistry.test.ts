import { describe, expect, it, vi } from 'vitest';
import { createPortRegistry } from './portRegistry';

describe('createPortRegistry', () => {
	it('tracks added ports', () => {
		const registry = createPortRegistry();
		const portA = { postMessage: vi.fn() };
		const portB = { postMessage: vi.fn() };

		registry.add(portA);
		registry.add(portB);

		expect(registry.size).toBe(2);
	});

	it('removes a specific port without disturbing others (tab-close cleanup)', () => {
		const registry = createPortRegistry();
		const portA = { postMessage: vi.fn() };
		const portB = { postMessage: vi.fn() };
		registry.add(portA);
		registry.add(portB);

		registry.remove(portA);

		expect(registry.size).toBe(1);
		expect(registry.all()).toEqual([portB]);
	});

	it('broadcast delivers to every tracked port', () => {
		const registry = createPortRegistry();
		const portA = { postMessage: vi.fn() };
		const portB = { postMessage: vi.fn() };
		registry.add(portA);
		registry.add(portB);

		registry.broadcast({ type: 'WS_OPEN' });

		expect(portA.postMessage).toHaveBeenCalledWith({ type: 'WS_OPEN' });
		expect(portB.postMessage).toHaveBeenCalledWith({ type: 'WS_OPEN' });
	});

	it('untracks a port whose postMessage throws instead of leaking it forever', () => {
		const registry = createPortRegistry();
		const deadPort = {
			postMessage: vi.fn(() => {
				throw new Error('port closed');
			}),
		};
		const alivePort = { postMessage: vi.fn() };
		registry.add(deadPort);
		registry.add(alivePort);

		registry.broadcast({ type: 'WS_MESSAGE' });
		expect(registry.size).toBe(1);
		expect(registry.all()).toEqual([alivePort]);

		// A second broadcast must not try the dead port again.
		registry.broadcast({ type: 'WS_MESSAGE' });
		expect(alivePort.postMessage).toHaveBeenCalledTimes(2);
	});
});
