import { describe, expect, it } from 'vitest';

import { resolveMime } from './audio-mime';

describe('resolveMime', () => {
	it('keeps a type the browser reported', () => {
		expect(resolveMime('audio/mpeg', 'a.mp3')).toBe('audio/mpeg');
		expect(resolveMime('application/pdf', 'a.pdf')).toBe('application/pdf');
	});

	it('fills in audio types from the extension when the browser reports none', () => {
		expect(resolveMime('', 'Song.MP3')).toBe('audio/mpeg');
		expect(resolveMime('application/octet-stream', 'x.m4a')).toBe('audio/mp4');
		expect(resolveMime('', 'x.flac')).toBe('audio/flac');
		expect(resolveMime('', 'x.opus')).toBe('audio/ogg');
		expect(resolveMime('', 'x.aac')).toBe('audio/aac');
		expect(resolveMime('', 'x.wav')).toBe('audio/wav');
	});

	it('uses the same names as the Android client for aliases', () => {
		expect(resolveMime('audio/mp3', 'a.mp3')).toBe('audio/mpeg');
		expect(resolveMime('audio/x-wav', 'a.wav')).toBe('audio/wav');
		expect(resolveMime('audio/x-m4a', 'a.m4a')).toBe('audio/mp4');
	});

	it('leaves unknown files as octet-stream', () => {
		expect(resolveMime('', 'archive.zip')).toBe('application/octet-stream');
		expect(resolveMime('', 'noextension')).toBe('application/octet-stream');
	});
});
