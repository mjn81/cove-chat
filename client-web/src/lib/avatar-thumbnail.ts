import { loadAvatar } from '@/lib/avatarCache';
import { MAX_AVATAR_DATA_URL_LENGTH, isPopupAvatar } from '@/domains/desktop/utils/sender-avatar';

/** Edge length in px of the thumbnail sent to the notification popup. */
const THUMB_SIZE = 64;

/**
 * Turns a profile photo into a small JPEG data URL for the notification popup, which runs in a separate process
 * with no session of its own. It reuses the avatar cache (so the photo is fetched with the user's session and
 * decrypted/cached once), crops to a square and downscales. Resolves to null when there is no usable photo; it
 * never throws.
 */
export async function avatarThumbnail(avatarId: string | undefined): Promise<string | null> {
	if (!avatarId) return null;
	try {
		const objectUrl = await loadAvatar(avatarId);
		if (!objectUrl) return null;
		const bitmap = await createImageBitmap(await (await fetch(objectUrl)).blob());
		const side = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = THUMB_SIZE;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
		bitmap.close();
		const url = canvas.toDataURL('image/jpeg', 0.8);
		return isPopupAvatar(url) && url.length <= MAX_AVATAR_DATA_URL_LENGTH ? url : null;
	} catch {
		return null;
	}
}
