import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSocketManager } from './socketManager';

// A minimal fake WebSocket the test fully controls — no real network I/O.
class FakeWebSocket {
	static OPEN = 1;
	static CONNECTING = 0;
	static CLOSED = 3;

	static instances: FakeWebSocket[] = [];

	url: string;
	readyState = FakeWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	sent: string[] = [];

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	open() {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}

	message(data: string) {
		this.onmessage?.({ data });
	}

	close(code = 1000) {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.({ code });
	}

	error(err: unknown) {
		this.onerror?.(err);
	}

	send(data: string) {
		this.sent.push(data);
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeWebSocket.instances = [];
	// @ts-expect-error test double
	globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createSocketManager', () => {
	it('opens a socket to the given URL and reports open/message/close to callbacks', () => {
		const onOpen = vi.fn();
		const onMessage = vi.fn();
		const onClose = vi.fn();
		const onError = vi.fn();
		const mgr = createSocketManager({ onOpen, onMessage, onClose, onError });

		mgr.connect('ws://test/ws');
		const sock = FakeWebSocket.instances[0];
		expect(sock.url).toBe('ws://test/ws');

		sock.open();
		expect(onOpen).toHaveBeenCalledTimes(1);

		sock.message('{"type":"ping"}');
		expect(onMessage).toHaveBeenCalledWith('{"type":"ping"}');

		sock.close(1000);
		expect(onClose).toHaveBeenCalledWith(1000);
	});

	it('reports transport errors via onError — this is the fix: the direct-connection path used to have no onerror handler at all', () => {
		const onError = vi.fn();
		const mgr = createSocketManager({
			onOpen: vi.fn(),
			onMessage: vi.fn(),
			onClose: vi.fn(),
			onError,
		});

		mgr.connect('ws://test/ws');
		const sock = FakeWebSocket.instances[0];
		const fakeErrorEvent = { message: 'boom' };
		sock.error(fakeErrorEvent);

		expect(onError).toHaveBeenCalledWith(fakeErrorEvent);
	});

	it('reconnects with backoff after an abnormal close', () => {
		const onOpen = vi.fn();
		const mgr = createSocketManager({
			onOpen,
			onMessage: vi.fn(),
			onClose: vi.fn(),
			onError: vi.fn(),
		});

		mgr.connect('ws://test/ws');
		FakeWebSocket.instances[0].open();
		FakeWebSocket.instances[0].close(1006); // abnormal closure

		expect(FakeWebSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(1000); // initial backoff delay
		expect(FakeWebSocket.instances).toHaveLength(2);
	});

	it('does NOT reconnect after a normal closure (1000) or going-away (1001)', () => {
		const mgr = createSocketManager({
			onOpen: vi.fn(),
			onMessage: vi.fn(),
			onClose: vi.fn(),
			onError: vi.fn(),
		});

		mgr.connect('ws://test/ws');
		FakeWebSocket.instances[0].open();
		FakeWebSocket.instances[0].close(1000);

		vi.advanceTimersByTime(60_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it('sends a heartbeat ping on an interval while open', () => {
		const mgr = createSocketManager({
			onOpen: vi.fn(),
			onMessage: vi.fn(),
			onClose: vi.fn(),
			onError: vi.fn(),
		});

		mgr.connect('ws://test/ws');
		const sock = FakeWebSocket.instances[0];
		sock.open();

		vi.advanceTimersByTime(25_000);
		expect(sock.sent).toEqual([JSON.stringify({ type: 'ping', payload: null })]);
	});

	it('disconnect() stops the heartbeat and does not schedule a reconnect', () => {
		const onClose = vi.fn();
		const mgr = createSocketManager({
			onOpen: vi.fn(),
			onMessage: vi.fn(),
			onClose,
			onError: vi.fn(),
		});

		mgr.connect('ws://test/ws');
		const sock = FakeWebSocket.instances[0];
		sock.open();

		mgr.disconnect();
		expect(sock.readyState).toBe(FakeWebSocket.CLOSED);

		vi.advanceTimersByTime(60_000);
		expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect attempt
	});

	it('isOpen() reflects the live socket state', () => {
		const mgr = createSocketManager({
			onOpen: vi.fn(),
			onMessage: vi.fn(),
			onClose: vi.fn(),
			onError: vi.fn(),
		});

		expect(mgr.isOpen()).toBe(false);

		mgr.connect('ws://test/ws');
		expect(mgr.isOpen()).toBe(false); // still connecting

		FakeWebSocket.instances[0].open();
		expect(mgr.isOpen()).toBe(true);

		FakeWebSocket.instances[0].close(1000);
		expect(mgr.isOpen()).toBe(false);
	});

	it('send() delivers through the live socket only while OPEN', () => {
		const mgr = createSocketManager({
			onOpen: vi.fn(),
			onMessage: vi.fn(),
			onClose: vi.fn(),
			onError: vi.fn(),
		});

		mgr.connect('ws://test/ws');
		const sock = FakeWebSocket.instances[0];

		mgr.send({ type: 'ping', payload: null }); // not open yet — dropped
		expect(sock.sent).toHaveLength(0);

		sock.open();
		mgr.send({ type: 'ping', payload: null });
		expect(sock.sent).toEqual([JSON.stringify({ type: 'ping', payload: null })]);
	});
});
