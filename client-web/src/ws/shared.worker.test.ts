import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the real worker script: it only needs `self.onconnect`, MessagePort-like objects and a WebSocket.

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

interface TabMessage {
	type: string;
	payload?: { type: string; payload: unknown };
}

function openTab() {
	const received: TabMessage[] = [];
	const port = {
		onmessage: null as ((e: { data: unknown }) => void) | null,
		postMessage: (msg: TabMessage) => void received.push(msg),
		start: () => {},
	};
	(self as unknown as { onconnect: (e: unknown) => void }).onconnect({ ports: [port] });
	const send = (cmd: string, payload: unknown = null) => port.onmessage?.({ data: { cmd, payload } });
	return {
		connect: () => send('CONNECT', { url: 'ws://backend/ws' }),
		disconnect: () => send('DISCONNECT'),
		leave: () => send('LEAVE'),
		keys: () => received.filter((m) => m.payload?.type === 'channel_key').map((m) => m.payload?.payload),
		events: (type: string) => received.filter((m) => m.payload?.type === type).map((m) => m.payload?.payload),
		send,
	};
}

const key = (channel: string, aes = 'a2V5') => ({ channel_id: channel, aes_key: aes });

/** A tab that opened the socket and received the server's on-connect keys. */
function signedInTab(...channels: string[]) {
	const tab = openTab();
	tab.connect();
	const socket = FakeSocket.all[FakeSocket.all.length - 1];
	socket.open();
	for (const channel of channels) socket.receive('channel_key', key(channel));
	return { tab, socket };
}

describe('shared worker replay to new tabs', () => {
	beforeEach(async () => {
		FakeSocket.all = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.resetModules();
		await import('./shared.worker');
	});

	afterEach(() => {
		// Stops the heartbeat timers of whatever socket a test left open.
		openTab().disconnect();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('gives a tab that reuses the open socket (reload, second tab) the keys the server sent on connect', () => {
		const { tab } = signedInTab('general', 'random');
		tab.leave();

		const reloaded = openTab();
		reloaded.connect();

		expect(FakeSocket.all).toHaveLength(1);
		expect(reloaded.keys()).toEqual([key('general'), key('random')]);
	});

	it('replays only the latest key of a channel', () => {
		const { socket } = signedInTab('general');
		socket.receive('channel_key', key('general', 'bmV3'));

		expect(openTab().keys()).toEqual([key('general', 'bmV3')]);
	});

	it('forgets the key of a deleted channel', () => {
		const { socket } = signedInTab('general', 'random');
		socket.receive('channel_delete', { channel_id: 'general' });

		expect(openTab().keys()).toEqual([key('random')]);
	});

	it('replays nothing after sign-out', () => {
		const { tab } = signedInTab('general');
		tab.disconnect();

		expect(openTab().keys()).toEqual([]);
	});

	it('replays nothing after the socket drops (the server resends on reconnect)', () => {
		const { socket } = signedInTab('general');
		socket.close(1008);

		expect(openTab().keys()).toEqual([]);
	});

	const call = (channel: string, users: string[]) => ({ channel_id: channel, users });
	const invite = (session: string) => ({ session_id: session, initiator_id: 'alice', pub_key: 'cHVi' });

	it('shows an ongoing call to a tab that reuses the socket', () => {
		const { socket } = signedInTab('general');
		socket.receive('voice_update', call('general', ['alice']));
		socket.receive('voice_update', call('general', ['alice', 'bob']));

		expect(openTab().events('voice_update')).toEqual([call('general', ['alice', 'bob'])]);
	});

	it('does not replay a call that ended or whose channel was deleted', () => {
		const { socket } = signedInTab('general', 'random');
		socket.receive('voice_update', call('general', ['alice']));
		socket.receive('voice_update', call('general', []));
		socket.receive('voice_update', call('random', ['bob']));
		socket.receive('channel_delete', { channel_id: 'random' });

		expect(openTab().events('voice_update')).toEqual([]);
	});

	it('replays a pending whisper invite', () => {
		const { socket } = signedInTab();
		socket.receive('whisper_init', invite('s1'));

		expect(openTab().events('whisper_init')).toEqual([invite('s1')]);
	});

	it.each(['whisper_accept', 'whisper_reject', 'whisper_close'])('forgets an invite once a tab sends %s', (type) => {
		const { tab, socket } = signedInTab();
		socket.receive('whisper_init', invite('s1'));
		tab.send('SEND', { type, payload: { session_id: 's1' } });

		expect(openTab().events('whisper_init')).toEqual([]);
	});

	it.each(['whisper_close', 'whisper_error'])('forgets an invite when the server sends %s', (type) => {
		const { socket } = signedInTab();
		socket.receive('whisper_init', invite('s1'));
		socket.receive(type, { session_id: 's1' });

		expect(openTab().events('whisper_init')).toEqual([]);
	});

	it('does not replay an invite the server has already expired', () => {
		vi.useFakeTimers();
		const { socket } = signedInTab();
		socket.receive('whisper_init', invite('s1'));
		vi.setSystemTime(Date.now() + 31 * 60_000);

		expect(openTab().events('whisper_init')).toEqual([]);
		vi.useRealTimers();
	});

	it('replays no call or invite after sign-out', () => {
		const { tab, socket } = signedInTab('general');
		socket.receive('voice_update', call('general', ['alice']));
		socket.receive('whisper_init', invite('s1'));
		tab.disconnect();

		const next = openTab();
		expect(next.events('voice_update')).toEqual([]);
		expect(next.events('whisper_init')).toEqual([]);
	});
});
