/** Number of letter-avatar colours the notification popup page defines (popup.Tones in Go). */
export const AVATAR_TONES = 5;

/** The data URL sent along with a notification must stay small; the popup process rejects bigger ones. */
export const MAX_AVATAR_DATA_URL_LENGTH = 48 * 1024;

/**
 * The letter shown in a sender's fallback avatar: their first letter or digit, upper-cased. Leading symbols such
 * as "@" or "#" are skipped. Returns "?" when the name has none.
 */
export function avatarInitial(name: string): string {
	const match = Array.from(name.trim()).find((ch) => /[\p{L}\p{N}]/u.test(ch));
	return match ? match.toLocaleUpperCase() : '?';
}

/**
 * Picks a stable colour slot (0..AVATAR_TONES-1) for a sender, so the same person always gets the same colour.
 *
 * @param seed - the user id (falls back to the name when there is none).
 */
export function avatarTone(seed: string): number {
	let hash = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % AVATAR_TONES;
}

/** True for the small raster image data URLs the popup accepts. */
export function isPopupAvatar(dataUrl: string | null | undefined): dataUrl is string {
	return (
		!!dataUrl &&
		dataUrl.length <= MAX_AVATAR_DATA_URL_LENGTH &&
		/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)
	);
}

/** Sentinel avatar id the server gives its built-in Cove account; its popups keep the Cove icon. */
export const SYSTEM_AVATAR_ID = 'system:cove';

/** Builds a notification sender from a user's id, display name and avatar id. */
export function senderFrom(id: string, name: string, avatarId?: string): NotificationSender {
	return { id, name, avatarId, system: avatarId === SYSTEM_AVATAR_ID };
}

/** Who a notification is from. */
export interface NotificationSender {
	id: string;
	name: string;
	avatarId?: string;
	/** True for Cove's built-in account, whose popups keep the Cove icon. */
	system?: boolean;
}

/** The sender-related fields of the popup payload. */
export interface SenderFields {
	avatar: string;
	initial: string;
	tone: number;
	system: boolean;
}

/**
 * Shapes the sender part of a popup payload: the downscaled photo when there is one, otherwise the letter and
 * colour for the fallback avatar. Nothing but these four fields is derived from the sender.
 */
export function buildSenderFields(sender: NotificationSender | undefined, avatarDataUrl?: string | null): SenderFields {
	if (!sender) return { avatar: '', initial: '', tone: 0, system: false };
	return {
		avatar: isPopupAvatar(avatarDataUrl) ? avatarDataUrl : '',
		initial: avatarInitial(sender.name),
		tone: avatarTone(sender.id || sender.name),
		system: !!sender.system,
	};
}
