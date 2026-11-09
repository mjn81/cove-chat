import { fitWithin } from './sticker-upload';

/**
 * Re-encodes a cropped static image as WebP no larger than `side` px (the server's sticker cap is 512), keeping
 * transparency. The server normalises again on upload; doing it here keeps uploads small and avoids relying on
 * the server's ffmpeg being present.
 *
 * @param source - The cropped image (any format the browser can decode).
 * @param side - Longest side in px.
 * @param quality - WebP quality 0..1.
 * @throws when the image cannot be decoded or the browser cannot encode WebP.
 */
export async function renderStickerWebp(source: Blob, side = 512, quality = 0.9): Promise<Blob> {
	const bitmap = await createImageBitmap(source);
	try {
		const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('canvas unavailable');
		ctx.drawImage(bitmap, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
		if (!blob || blob.type !== 'image/webp') throw new Error('webp encoding unavailable');
		return blob;
	} finally {
		bitmap.close();
	}
}
