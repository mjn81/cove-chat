import { describe, expect, it } from 'vitest';
import {
	H264_DECODER_CONFIG,
	MAX_FRAME_BYTES,
	allowKeyframe,
	detectCodecSupport,
	fitEven,
	h264EncoderConfig,
	schedulePlayout,
	screenLimit,
} from './udp-policy';

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

describe('h264EncoderConfig', () => {
	const codec = (w: number, h: number, fps: number) => h264EncoderConfig(w, h, fps, 1_000_000).codec;
	it('keeps level 3.1 up to 720p30', () => {
		expect(codec(640, 480, 30)).toBe('avc1.42E01f');
		expect(codec(1280, 720, 30)).toBe('avc1.42E01f');
	});
	it('raises the level with the picture size and rate', () => {
		expect(codec(1280, 720, 60)).toBe('avc1.42E020');
		expect(codec(1920, 1080, 30)).toBe('avc1.42E028');
		expect(codec(1920, 1080, 60)).toBe('avc1.42E02a');
		expect(codec(2560, 1440, 30)).toBe('avc1.42E032');
		expect(codec(3840, 2160, 30)).toBe('avc1.42E033');
		expect(codec(3840, 2160, 60)).toBe('avc1.42E034');
	});
	it('decodes any of those levels', () => {
		expect(H264_DECODER_CONFIG.codec).toBe('avc1.42E034');
	});
});

describe('MAX_FRAME_BYTES', () => {
	it('fits a text-heavy screen keyframe', () => {
		expect(MAX_FRAME_BYTES).toBe(1024 * 1100);
	});
});
