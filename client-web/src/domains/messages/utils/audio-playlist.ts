import type { VoiceTrack } from '@/lib/voicePlayer';

/** The part of a file message's decrypted metadata the playlist needs. */
export interface AudioFileMeta {
	file_id: string;
	name?: string;
	mime: string;
	nonce: string;
}

/** Recorded voice notes are all named `voice-message.*`, which says nothing; they show who sent them instead. */
const GENERIC_NAME = /^voice-message/i;

/**
 * Turns one decrypted file message into a playlist entry.
 *
 * @param meta - Decrypted file metadata.
 * @param kind - The message type (`voice` for recorded notes).
 * @param channelId - Channel the message is in.
 * @param senderName - Name shown for voice notes and unnamed files.
 * @returns the track, or null when the file is not audio.
 */
export function toAudioTrack(
	meta: AudioFileMeta,
	kind: string,
	channelId: string,
	senderName: string,
): VoiceTrack | null {
	if (kind !== 'voice' && !meta.mime.startsWith('audio/')) return null;
	const named = meta.name && !GENERIC_NAME.test(meta.name) ? meta.name : undefined;
	return {
		fileId: meta.file_id,
		channelId,
		mime: meta.mime,
		nonce: meta.nonce,
		waveform: null,
		label: kind === 'voice' ? senderName : (named ?? senderName),
	};
}

/**
 * Orders playlist entries the way the chat reads, oldest first.
 *
 * @param entries - Tracks paired with the time their message was sent (ISO strings).
 */
export function sortPlaylist(entries: { track: VoiceTrack; sentAt: string }[]): VoiceTrack[] {
	return [...entries].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).map((e) => e.track);
}
