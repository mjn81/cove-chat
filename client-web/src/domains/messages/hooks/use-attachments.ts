import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { encryptAndUploadFile } from '@/domains/files/utils/upload-encrypted-file';
import { useAppStore } from '@/store/store';
import { playNotificationSound } from '@/utils/notifications';
import { logger } from '@/utils/logger';
import { wsSendMessage } from '@/ws';

export type AttachmentStatus = 'idle' | 'encrypting' | 'uploading' | 'done' | 'failed';

/** A file waiting in the composer, with its upload progress. */
export interface QueuedAttachment {
	file: File;
	id: string;
	status: AttachmentStatus;
	/** 0-100. */
	progress: number;
	/** Send as a plain document even if it is an image. */
	asDocument?: boolean;
	error?: string;
}

/**
 * The composer's attachment queue: add/remove files, send them one by one
 * (each fails independently so one bad upload does not swallow the batch),
 * and keep failed ones around for retry.
 */
export function useAttachments() {
	const { t } = useTranslation();
	const [files, setFiles] = useState<QueuedAttachment[]>([]);

	const update = useCallback(
		(id: string, status: AttachmentStatus, progress = 0, error?: string) =>
			setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status, progress, error } : f))),
		[],
	);

	const add = useCallback((newFiles: File[], asDocument = false) => {
		setFiles((prev) => [
			...prev,
			...newFiles.map((file) => ({
				file,
				id: Math.random().toString(36).substring(7),
				status: 'idle' as const,
				progress: 0,
				asDocument,
			})),
		]);
	}, []);

	const remove = useCallback((id: string) => setFiles((prev) => prev.filter((f) => f.id !== id)), []);

	/** Resets a failed file so the next send picks it up again. */
	const reset = useCallback((id: string) => update(id, 'idle', 0, undefined), [update]);

	/**
	 * Sends every queued file to the channel, then drops the successful ones.
	 *
	 * @param channelId - Destination channel.
	 * @param channelKey - Channel key used for client-side encryption.
	 */
	const sendAll = useCallback(
		async (channelId: string, channelKey: Uint8Array) => {
			for (const f of files) {
				try {
					const uploaded = await encryptAndUploadFile({
						file: f.file,
						channelKey,
						channelId,
						asDocument: f.asDocument,
						onStage: (stage) => update(f.id, stage, stage === 'encrypting' ? 30 : 0),
						onProgress: (percent) => update(f.id, 'uploading', percent),
					});

					if (useAppStore.getState().wsState !== 'connected') {
						update(f.id, 'failed', 100, t('composer.errors.not_connected_retry'));
						continue;
					}

					await wsSendMessage(channelId, uploaded.metadata(), 'file', 'zstd');
					update(f.id, 'done', 100);
					playNotificationSound('file-upload');
				} catch (err) {
					logger.error('Failed to send file', { error: String(err) });
					update(f.id, 'failed', 0, err instanceof Error ? err.message : t('composer.errors.file_failed'));
				}
			}

			// Drop successfully-sent files, keep failed ones visible for retry.
			setFiles((prev) => prev.filter((f) => f.status === 'failed'));
		},
		[files, update, t],
	);

	return { files, add, remove, reset, sendAll };
}
