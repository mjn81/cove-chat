import { describe, expect, it } from 'vitest';
import { callsNeedNativeClient } from '@/lib/call-support';

describe('callsNeedNativeClient', () => {
	it('is false while capabilities are unknown, so calls are not blocked on a slow request', () => {
		expect(callsNeedNativeClient(undefined)).toBe(false);
	});

	it('is false on a WebRTC server', () => {
		expect(callsNeedNativeClient(['invite_messages', 'whisper', 'webrtc_sfu'])).toBe(false);
	});

	it('is true on an air-gapped server advertising encrypted UDP media', () => {
		expect(callsNeedNativeClient(['whisper', 'raw_udp_voice', 'raw_udp_media'])).toBe(true);
	});

	it('is true on an older raw_udp server that only advertises raw_udp_voice', () => {
		expect(callsNeedNativeClient(['whisper', 'raw_udp_voice'])).toBe(true);
	});

	it('is false for a client that can speak the native media protocol', () => {
		expect(callsNeedNativeClient(['raw_udp_media', 'raw_udp_voice'], true)).toBe(false);
	});

	it('is false for servers with no calling capability at all', () => {
		expect(callsNeedNativeClient(['whisper'])).toBe(false);
	});
});

describe('useUdpMediaTransport', () => {
	it('is false in a browser even on raw_udp servers', async () => {
		const { useUdpMediaTransport } = await import('@/lib/call-support');
		expect(useUdpMediaTransport(['raw_udp_media', 'raw_udp_voice'])).toBe(false);
	});
});
