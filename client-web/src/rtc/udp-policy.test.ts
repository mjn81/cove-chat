import { describe, expect, it } from 'vitest';
import { allowKeyframe, detectCodecSupport, fitEven, schedulePlayout, screenLimit } from './udp-policy';

describe('schedulePlayout', () => {
	it('starts a lead ahead of now on the first chunk', () => {
		expect(schedulePlayout(null, 10, 0.02).start).toBeCloseTo(10.06);
	});
	it('chains chunks back to back', () => {
		const a = schedulePlayout(null, 10, 0.02);
		const b = schedulePlayout(a.state, 10.01, 0.02);
		expect(b.start).toBeCloseTo(a.start + 0.02);
	});
	it('resyncs after an underrun', () => {
		const a = schedulePlayout(null, 10, 0.02);
		expect(schedulePlayout(a.state, 11, 0.02).start).toBeCloseTo(11.06);
	});
	it('resyncs when latency creeps up', () => {
		expect(schedulePlayout({ next: 12 }, 10, 0.02).start).toBeCloseTo(10.06);
	});
});

describe('allowKeyframe', () => {
	it('rate limits', () => {
		expect(allowKeyframe(null, 0)).toBe(true);
		expect(allowKeyframe(0, 100)).toBe(false);
		expect(allowKeyframe(0, 500)).toBe(true);
	});
});

describe('fitEven', () => {
	it('scales down keeping aspect and even sizes', () => {
		expect(fitEven(2560, 1440, screenLimit('1080p'))).toEqual({ w: 1920, h: 1080 });
		expect(fitEven(1001, 667, null)).toEqual({ w: 1000, h: 666 });
	});
	it('never upscales', () => {
		expect(fitEven(640, 360, screenLimit('1080p'))).toEqual({ w: 640, h: 360 });
	});
});

describe('detectCodecSupport', () => {
	const sup = { isConfigSupported: async () => ({ supported: true }) };
	const none = { isConfigSupported: async () => ({ supported: false }) };
	it('needs the track processor', async () => {
		expect(await detectCodecSupport({ AudioEncoder: sup, AudioDecoder: sup } as never)).toEqual({ audio: false, video: false });
	});
	it('reports audio and video independently', async () => {
		const r = await detectCodecSupport({
			MediaStreamTrackProcessor: class {},
			AudioEncoder: sup,
			AudioDecoder: sup,
			VideoEncoder: none,
			VideoDecoder: sup,
		} as never);
		expect(r).toEqual({ audio: true, video: false });
	});
	it('treats a throwing probe as unsupported', async () => {
		const bad = { isConfigSupported: async () => { throw new Error('x'); } };
		const r = await detectCodecSupport({ MediaStreamTrackProcessor: class {}, AudioEncoder: bad, AudioDecoder: bad } as never);
		expect(r.audio).toBe(false);
	});
});
