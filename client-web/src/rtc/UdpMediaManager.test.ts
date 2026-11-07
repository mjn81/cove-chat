import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (p: unknown) => void>();
const sent: Array<{ type: string; args: unknown[] }> = [];
vi.mock('@/ws', () => ({
	onWS: (e: string, fn: (p: unknown) => void) => {
		handlers.set(e, fn);
		return () => handlers.delete(e);
	},
	wsSendCallJoin: (...args: unknown[]) => sent.push({ type: 'join', args }),
	wsSendCallLeave: (...args: unknown[]) => sent.push({ type: 'leave', args }),
	wsSendCallTrackState: (...args: unknown[]) => sent.push({ type: 'track', args }),
}));
vi.mock('@/api/client', () => ({ apiClient: { defaults: { baseURL: 'http://10.0.0.5:8080' } } }));
vi.mock('./udp-policy', async (orig) => ({ ...(await orig<typeof import('./udp-policy')>()), detectCodecSupport: async () => ({ audio: true, video: false }) }));

import { UdpMediaManager, setUdpPort } from './UdpMediaManager';
import type { MediaBridge } from './udp-bridge';
import { useVoiceStore } from '@/store/voiceStore';

function fakeBridge() {
	const b = {
		begin: vi.fn(async () => ({ client_pub: 'pub', client_nonce: 'nonce' })),
		complete: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
		sendFrames: vi.fn(async () => {}),
		requestKeyframe: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		onFrames: vi.fn(() => () => {}),
		onKeyframeRequest: vi.fn(() => () => {}),
	};
	return b satisfies MediaBridge;
}

describe('UdpMediaManager', () => {
	beforeEach(() => {
		handlers.clear();
		sent.length = 0;
		vi.stubGlobal('AudioContext', class { state = 'running'; resume = async () => {}; close = async () => {}; });
	});

	it('sends call_join with the ECDH public key and starts connecting', async () => {
		const bridge = fakeBridge();
		const m = new UdpMediaManager(() => bridge);
		await m.join('chan1');
		expect(bridge.begin).toHaveBeenCalled();
		expect(sent[0]).toEqual({ type: 'join', args: ['chan1', { client_pub: 'pub', client_nonce: 'nonce' }] });
		expect(useVoiceStore.getState().callStatus).toBe('connecting');
		await m.leave();
		expect(bridge.close).toHaveBeenCalled();
		expect(sent.some((s) => s.type === 'leave')).toBe(true);
	});

	it('dials the server host with the advertised UDP port', async () => {
		setUdpPort(9191);
		const bridge = fakeBridge();
		const m = new UdpMediaManager(() => bridge);
		await m.join('chan1');
		handlers.get('call_joined')!({
			channel_id: 'chan1',
			self_id: 'me',
			participants: [{ user_id: 'u2', username: 'b', track_states: { audio: true }, media_id: 2 }],
			media: { session_id: 's', server_pub: 'p', server_nonce: 'n', media_id: 1, max_packet: 1200, epoch: 0 },
		});
		await vi.waitFor(() => expect(bridge.complete).toHaveBeenCalled());
		expect(bridge.complete.mock.calls[0][0]).toBe('10.0.0.5:9191');
		await m.leave();
	});

	it('leaves when the server ends the call (kick)', async () => {
		const bridge = fakeBridge();
		const m = new UdpMediaManager(() => bridge);
		await m.join('chan1');
		handlers.get('call_ended')!({ channel_id: 'chan1', error: '', reason: 'kicked' });
		await vi.waitFor(() => expect(bridge.close).toHaveBeenCalled());
		expect(useVoiceStore.getState().isActive).toBe(false);
	});

	it('ignores errors for other channels', async () => {
		const bridge = fakeBridge();
		const m = new UdpMediaManager(() => bridge);
		await m.join('chan1');
		handlers.get('call_error')!({ channel_id: 'other', error: 'x' });
		expect(bridge.close).not.toHaveBeenCalled();
		await m.leave();
	});
});
