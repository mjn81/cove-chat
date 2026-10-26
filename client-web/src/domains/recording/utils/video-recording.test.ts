import { describe, expect, it } from 'vitest';

import {
	MAX_VIDEO_SECONDS,
	formatSecondsCeil,
	isVideoTrimmed,
	pickVideoMimeType,
	progressRing,
	videoFileMeta,
} from './video-recording';

describe('formatSecondsCeil', () => {
	it('rounds partial seconds up so the countdown never shows 0:00 while recording', () => {
		expect(formatSecondsCeil(59.2)).toBe('1:00');
		expect(formatSecondsCeil(0.4)).toBe('0:01');
		expect(formatSecondsCeil(0)).toBe('0:00');
		expect(formatSecondsCeil(75)).toBe('1:15');
	});
});

describe('pickVideoMimeType', () => {
	it('returns the first supported type, or an empty string for the browser default', () => {
		expect(pickVideoMimeType(() => true)).toBe('video/webm;codecs=vp8,opus');
		expect(pickVideoMimeType((t) => t === 'video/mp4')).toBe('video/mp4');
		expect(pickVideoMimeType(() => false)).toBe('');
	});
});

describe('videoFileMeta', () => {
	it('uses mp4 only for mp4 blobs and falls back to a default mime type', () => {
		expect(videoFileMeta('video/mp4', 1)).toEqual({ name: 'video_message_1.mp4', type: 'video/mp4' });
		expect(videoFileMeta('video/webm;codecs=vp8', 1).name).toBe('video_message_1.webm');
		expect(videoFileMeta('', 1).type).toBe('video/mp4');
	});
});

describe('isVideoTrimmed', () => {
	it('needs more than half a second cut from either end', () => {
		expect(isVideoTrimmed(0.4, 9.6, 10)).toBe(false);
		expect(isVideoTrimmed(0.6, 10, 10)).toBe(true);
		expect(isVideoTrimmed(0, 9, 10)).toBe(true);
	});
});

describe('progressRing', () => {
	it('shrinks the visible stroke as time runs out', () => {
		const full = progressRing(MAX_VIDEO_SECONDS);
		const half = progressRing(MAX_VIDEO_SECONDS / 2);
		expect(full.dashOffset).toBe(0);
		expect(half.dashOffset).toBeCloseTo(full.perimeter / 2);
		expect(progressRing(0).dashOffset).toBeCloseTo(full.perimeter);
	});
});
