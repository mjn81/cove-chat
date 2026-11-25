import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the real page-side client against the real worker script, joined by fake MessagePorts.

class FakeSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 3;
	static all: FakeSocket[] = [];

	readyState = FakeSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((e: { data: string }) => void) | null = null;
	onclose: ((e: { code: number }) => void) | null = null;
	onerror: (() => void) | null = null;

	constructor() {
		FakeSocket.all.push(this);
	}
	send() {}
	close(code = 1000) {
		this.readyState = FakeSocket.CLOSED;
		this.onclose?.({ code });
	}
	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}
	receive(type: string, payload: unknown) {
		this.onmessage?.({ data: JSON.stringify({ type, payload }) });
	}
}

type Handler = ((e: { data: unknown }) => void) | null;

class FakeSharedWorker {
	port: { onmessage: Handler; postMessage: (m: unknown) => void; start: () => void; close: () => void };

	constructor() {
		let closed = false;
		const workerPort = {
			onmessage: null as Handler,
			postMessage: (data: unknown) => {
				if (!closed) this.port.onmessage?.({ data });
			},
			start: () => {},
		};
		this.port = {
			onmessage: null,
			postMessage: (data) => workerPort.onmessage?.({ data }),
			start: () => {},
			close: () => void (closed = true),
		};
		(self as unknown as { onconnect: (e: unknown) => void }).onconnect({ ports: [workerPort] });
	}
}

function pageTransition(type: 'pagehide' | 'pageshow') {
	window.dispatchEvent(Object.assign(new Event(type), { persisted: true }));
}

describe('ws client over the shared worker', () => {
	let ws: typeof import('./ws');
	let received: unknown[];

	const socket = () => FakeSocket.all[FakeSocket.all.length - 1];
	const signIn = () => {
		ws.wsConnect();
		socket().open();
	};

	beforeEach(async () => {
		FakeSocket.all = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		vi.stubGlobal('SharedWorker', FakeSharedWorker);
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.resetModules();
		await import('./ws/shared.worker');
		ws = await import('./ws');
		received = [];
		ws.onWS('message', (payload) => received.push(payload));
	});

	afterEach(() => {
		ws.wsDisconnect();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('delivers each event once after sign-out and sign-in in the same tab', () => {
		signIn();
		ws.wsDisconnect();
		signIn();

		socket().receive('message', { id: 'm1' });

		expect(received).toEqual([{ id: 'm1' }]);
	});

	it('receives events again after being restored from the back/forward cache', () => {
		signIn();
		pageTransition('pagehide');
		pageTransition('pageshow');

		socket().receive('message', { id: 'm1' });

		expect(received).toEqual([{ id: 'm1' }]);
		expect(FakeSocket.all).toHaveLength(1);
	});

	it('also leaves and rejoins with the port made by a later sign-in', () => {
		signIn();
		ws.wsDisconnect();
		signIn();
		pageTransition('pagehide');

		socket().receive('message', { id: 'while-hidden' });
		pageTransition('pageshow');
		socket().receive('message', { id: 'm1' });

		expect(received).toEqual([{ id: 'm1' }]);
	});

	it('stays signed out when restored after sign-out', () => {
		signIn();
		ws.wsDisconnect();
		pageTransition('pagehide');
		pageTransition('pageshow');

		expect(FakeSocket.all).toHaveLength(1);
	});
});
