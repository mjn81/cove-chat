import { describe, expect, it } from 'vitest';

import {
	computeLiveLevels,
	formatDuration,
	pickRecorderMimeType,
	voiceFileMeta,
} from './recording';

describe('formatDuration', () => {
	it('formats seconds as m:ss', () => {
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(9)).toBe('0:09');
		expect(formatDuration(75.9)).toBe('1:15');
		expect(formatDuration(600)).toBe('10:00');
	});
});

describe('computeLiveLevels', () => {
	it('returns one percentage per bar, between 14 and 100', () => {
		const loud = computeLiveLevels(new Uint8Array(64).fill(255), 28);
		expect(loud).toHaveLength(28);
		expect(Math.max(...loud)).toBe(100);
		const silent = computeLiveLevels(new Uint8Array(64), 28);
		expect(Math.min(...silent)).toBe(14);
	});
});

describe('pickRecorderMimeType', () => {
	it('prefers Opus in WebM, then falls back in order', () => {
		expect(pickRecorderMimeType(() => true)).toBe('audio/webm;codecs=opus');
		expect(pickRecorderMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
	});

	it('returns undefined when nothing is supported so the browser default is used', () => {
		expect(pickRecorderMimeType(() => false)).toBeUndefined();
	});
});

describe('voiceFileMeta', () => {
	it('names WAV exports, OGG and WebM recordings', () => {
		expect(voiceFileMeta('audio/wav', 5)).toEqual({ name: 'voice-note-5.wav', type: 'audio/wav' });
		expect(voiceFileMeta('audio/ogg;codecs=opus', 5)).toEqual({
			name: 'voice-note-5.ogg',
			type: 'audio/ogg;codecs=opus',
		});
		expect(voiceFileMeta('', 5)).toEqual({ name: 'voice-note-5.webm', type: 'audio/webm;codecs=opus' });
	});
});
