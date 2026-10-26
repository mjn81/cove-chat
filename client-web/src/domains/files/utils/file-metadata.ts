/** Everything the receiver needs to download and decrypt an uploaded file. */
export interface FileMetadataInput {
	fileId: string;
	name: string;
	mime: string;
	/** Original (uncompressed, unencrypted) size in bytes. */
	size: number;
	/** Base64 nonce used to encrypt the file body. */
	nonce: string;
	/** Base64 encrypted thumbnail and its nonce (images/videos). */
	thumbCiphertext?: string;
	thumbNonce?: string;
	/** Voice/video duration in seconds. */
	duration?: number;
	/** Sent as a plain document even if it is an image. */
	asDocument?: boolean;
	/** Set to `processing` while the server transcodes a video message. */
	processingStatus?: string;
}

/**
 * Serialises the JSON payload that is encrypted into a file/voice/video
 * message. Optional fields are left out entirely so older clients and the
 * stored ciphertext stay as small as before.
 *
 * @returns The JSON string to pass to `wsSendMessage`.
 */
export function buildFileMetadata(input: FileMetadataInput): string {
	return JSON.stringify({
		file_id: input.fileId,
		name: input.name,
		mime: input.mime,
		size: input.size,
		duration: input.duration,
		nonce: input.nonce,
		thumb_ciphertext: input.thumbCiphertext,
		thumb_nonce: input.thumbNonce,
		as_document: input.asDocument ? true : undefined,
		processing_status: input.processingStatus,
	});
}
