import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { encryptAndUploadFile } from '@/domains/files/utils/upload-encrypted-file';
import { useAppStore } from '@/store/store';
import { playNotificationSound } from '@/utils/notifications';
import { logger } from '@/utils/logger';
import { wsSendMessage } from '@/ws';
import type { Channel, Message } from '@/types/api';

/** Video messages are capped by size and length (the server transcodes them). */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

/** Reads a video's duration without playing it. */
function readVideoDuration(file: File): Promise<number> {
	return new Promise((resolve, reject) => {
		const video = document.createElement('video');
		const url = URL.createObjectURL(file);
		video.preload = 'metadata';
		video.onloadedmetadata = () => {
			URL.revokeObjectURL(url);
			resolve(video.duration);
		};
		video.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load video metadata'));
		};
		video.src = url;
	});
}

interface UseSendMediaArgs {
	channel: Channel;
	channelKey: Uint8Array;
	replyTo?: (Message & { text?: string }) | null;
	onCancelReply?: () => void;
	/** Shows a message in the composer's error banner. */
	onError: (message: string) => void;
	/** Puts a file in the attachment queue so the user can retry it. */
	onQueueFile: (file: File) => void;
	setSending: (sending: boolean) => void;
}

/**
 * Sends voice and video messages straight from the recorders. On a failure
 * voice recordings are kept in the attachment queue so nothing is lost.
 */
export function useSendMedia({
	channel,
	channelKey,
	replyTo,
	onCancelReply,
	onError,
	onQueueFile,
	setSending,
}: UseSendMediaArgs) {
	const { t } = useTranslation();

	const sendVoice = useCallback(
		async (voiceFile: File, voiceDuration?: number) => {
			try {
				const uploaded = await encryptAndUploadFile({ file: voiceFile, channelKey, channelId: channel.id });
				const payload = uploaded.metadata({
					name: voiceFile.name,
					duration: voiceDuration ? Math.round(voiceDuration) : undefined,
				});

				if (useAppStore.getState().wsState !== 'connected') {
					onError(t('composer.errors.voice_not_connected'));
					onQueueFile(voiceFile);
					return;
				}

				await wsSendMessage(channel.id, payload, 'voice', 'none', replyTo?.id);
				playNotificationSound('message');
				if (replyTo) onCancelReply?.();
			} catch (err) {
				logger.error('Failed to send direct voice message', { error: String(err) });
				onError(t('composer.errors.voice_failed'));
				onQueueFile(voiceFile);
			}
		},
		[channel.id, channelKey, replyTo, onCancelReply, onError, onQueueFile, t],
	);

	const sendVideo = useCallback(
		async (videoFile: File) => {
			if (videoFile.size > MAX_VIDEO_BYTES) {
				toast.error(t('errors.video_too_large', { size: 50 }));
				return;
			}

			try {
				const duration = await readVideoDuration(videoFile);
				if (duration > MAX_VIDEO_SECONDS) {
					toast.error(
						t('errors.video_too_long', { max: MAX_VIDEO_SECONDS, duration: Math.round(duration) }),
					);
					return;
				}

				setSending(true);
				const uploaded = await encryptAndUploadFile({
					file: videoFile,
					channelKey,
					channelId: channel.id,
					isVideoMessage: true,
				});
				const payload = uploaded.metadata({
					name: videoFile.name,
					duration: Math.round(duration),
					processingStatus: 'processing',
				});

				if (useAppStore.getState().wsState !== 'connected') {
					onError(t('composer.errors.video_not_connected'));
					return;
				}

				await wsSendMessage(channel.id, payload, 'video', 'none', replyTo?.id);
				playNotificationSound('message');
				if (replyTo) onCancelReply?.();
			} catch (err) {
				logger.error('Failed to send video message', { error: String(err) });
				onError(err instanceof Error && err.message ? err.message : t('composer.errors.video_failed'));
			} finally {
				setSending(false);
			}
		},
		[channel.id, channelKey, replyTo, onCancelReply, onError, setSending, t],
	);

	return { sendVoice, sendVideo };
}
