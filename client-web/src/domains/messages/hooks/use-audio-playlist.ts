import { useEffect, useRef } from 'react';

import { voicePlayer, type VoiceTrack } from '@/lib/voicePlayer';
import { decryptMessage } from '@/ws';
import { logger } from '@/utils/logger';
import type { Channel, Message } from '@/types/api';
import { sortPlaylist, toAudioTrack, type AudioFileMeta } from '../utils/audio-playlist';

/**
 * Keeps the player's playlist in step with the audio in the open chat: voice notes and audio files, oldest first, so
 * the playlist lists them and the next one starts when one ends. Metadata is decrypted once per message.
 *
 * @param channel - The open chat.
 * @param messages - Its loaded messages.
 */
export function useAudioPlaylist(channel: Channel, messages: Message[]) {
	// Message id -> track, or null for messages that are not audio, so nothing is decrypted twice.
	const cache = useRef(new Map<string, VoiceTrack | null>());

	useEffect(() => {
		cache.current.clear();
	}, [channel.id]);

	useEffect(() => {
		let cancelled = false;
		const candidates = messages.filter((m) => m.type === 'voice' || m.type === 'file');

		(async () => {
			for (const m of candidates) {
				if (cache.current.has(m.id) || m.id.startsWith('local-')) continue;
				try {
					const parsed = JSON.parse(await decryptMessage(m)) as AudioFileMeta;
					const senderName = channel.member_names?.[m.sender_id] ?? '';
					cache.current.set(m.id, toAudioTrack(parsed, m.type, channel.id, senderName));
				} catch (err) {
					// Not decryptable yet (the channel key may still be on its way): try again on the next change.
					logger.debug('Playlist: skipped a message', { error: String(err) });
				}
			}
			if (cancelled) return;
			const entries = candidates.flatMap((m) => {
				const track = cache.current.get(m.id);
				return track ? [{ track, sentAt: m.sent_at }] : [];
			});
			voicePlayer.setQueue(channel.id, sortPlaylist(entries));
		})();

		return () => {
			cancelled = true;
		};
	}, [channel.id, channel.member_names, messages]);
}
