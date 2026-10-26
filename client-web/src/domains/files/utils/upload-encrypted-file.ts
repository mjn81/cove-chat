import { apiUploadFile } from '@/api/client';
import { db } from '@/lib/db';
import { encryptAndCompressFile } from '@/utils/file';
import { logger } from '@/utils/logger';
import { bytesToBase64 } from '@/ws';
import { buildFileMetadata, type FileMetadataInput } from './file-metadata';

type Processed = Awaited<ReturnType<typeof encryptAndCompressFile>>;

interface UploadOptions {
	file: File;
	channelKey: Uint8Array;
	channelId: string;
	/** Skip thumbnailing/compression so an image is sent as a plain document. */
	asDocument?: boolean;
	/** Tell the server this is a video message so it can transcode it. */
	isVideoMessage?: boolean;
	/** Fires when the work moves from encrypting to uploading. */
	onStage?: (stage: 'encrypting' | 'uploading') => void;
	/** Upload progress, 0-100. */
	onProgress?: (percent: number) => void;
}

/** Result of {@link encryptAndUploadFile}. */
export interface UploadedEncryptedFile {
	fileId: string;
	processed: Processed;
	/** Builds the message payload; pass extras such as `duration` for voice/video. */
	metadata: (extra?: Partial<FileMetadataInput>) => string;
}

/**
 * Client-side encrypts a file with the channel key, uploads the ciphertext,
 * and pre-caches the plaintext locally so the sender sees the file as
 * already opened instead of downloading their own upload.
 *
 * @throws If encryption or the upload fails (cache failures are only logged).
 */
export async function encryptAndUploadFile({
	file,
	channelKey,
	channelId,
	asDocument,
	isVideoMessage,
	onStage,
	onProgress,
}: UploadOptions): Promise<UploadedEncryptedFile> {
	onStage?.('encrypting');
	const processed = await encryptAndCompressFile(file, channelKey, asDocument ? { asDocument } : undefined);

	onStage?.('uploading');
	const res = await apiUploadFile(
		new Blob([processed.ciphertext as BlobPart], { type: processed.mimeType }),
		processed.mimeType,
		processed.thumbnailCipher ? bytesToBase64(processed.thumbnailCipher) : undefined,
		processed.thumbnailNonce ? bytesToBase64(processed.thumbnailNonce) : undefined,
		onProgress
			? (e) => onProgress(Math.round(((e.loaded as number) * 100) / (e.total as number)))
			: undefined,
		channelId,
		isVideoMessage ? true : undefined,
	);

	try {
		await db.cacheFile(res.id, processed.rawBytes, processed.mimeType, processed.originalSize);
	} catch (cacheErr) {
		logger.warn('Failed to pre-cache uploaded file', { error: String(cacheErr) });
	}

	return {
		fileId: res.id,
		processed,
		metadata: (extra) =>
			buildFileMetadata({
				fileId: res.id,
				name: processed.fileName || file.name,
				mime: processed.mimeType,
				size: processed.originalSize,
				nonce: bytesToBase64(processed.nonce),
				thumbCiphertext: processed.thumbnailCipher ? bytesToBase64(processed.thumbnailCipher) : undefined,
				thumbNonce: processed.thumbnailNonce ? bytesToBase64(processed.thumbnailNonce) : undefined,
				asDocument,
				...extra,
			}),
	};
}
