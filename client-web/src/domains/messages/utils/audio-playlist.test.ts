import { describe, expect, it } from 'vitest';

import { sortPlaylist, toAudioTrack } from './audio-playlist';

const meta = (over: Partial<Parameters<typeof toAudioTrack>[0]> = {}) => ({
	file_id: 'f1',
	name: 'Song.mp3',
	mime: 'audio/mpeg',
	nonce: 'n',
	...over,
});

describe('toAudioTrack', () => {
	it('keeps a music file under its own name', () => {
		expect(toAudioTrack(meta(), 'file', 'c1', 'mjn')).toMatchObject({ fileId: 'f1', channelId: 'c1', label: 'Song.mp3' });
	});

	it('shows the sender for recorded voice notes', () => {
		expect(toAudioTrack(meta({ name: 'voice-message.m4a', mime: 'audio/mp4' }), 'voice', 'c1', 'mjn')?.label).toBe('mjn');
	});

	it('shows the sender for a file with a generic recorder name', () => {
		expect(toAudioTrack(meta({ name: 'voice-message.webm' }), 'file', 'c1', 'sara')?.label).toBe('sara');
	});

	it('skips anything that is not audio', () => {
		expect(toAudioTrack(meta({ mime: 'image/png', name: 'a.png' }), 'file', 'c1', 'mjn')).toBeNull();
	});

	it('accepts a voice message whatever its mime says', () => {
		expect(toAudioTrack(meta({ mime: 'application/octet-stream' }), 'voice', 'c1', 'mjn')).not.toBeNull();
	});
});

describe('sortPlaylist', () => {
	it('puts the oldest message first', () => {
		const t = (id: string) => ({ fileId: id, channelId: 'c', mime: 'audio/mpeg', nonce: '', waveform: null });
		const sorted = sortPlaylist([
			{ track: t('b'), sentAt: '2026-11-01T10:05:00Z' },
			{ track: t('a'), sentAt: '2026-11-01T10:00:00Z' },
		]);
		expect(sorted.map((x) => x.fileId)).toEqual(['a', 'b']);
	});
});
