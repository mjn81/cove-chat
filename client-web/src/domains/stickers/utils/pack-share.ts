/**
 * The "Add stickers" share card. The server has no dedicated message type for it (docs/packs-api.md defines only
 * `sticker`), so a shared pack travels as an ordinary `text` message whose whole body is one link-like token,
 * `cove://stickers/<pack id>`. New clients draw a card with an Add button; clients that do not know the format show
 * the token as plain text. The pack id is as unguessable as a file id and is the share capability itself
 * (`GET /api/packs/{id}` and `PUT /api/packs/{id}/install` accept any user pack id).
 */

const PREFIX = 'cove://stickers/';
const PACK_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Builds the message text that shares a pack.
 *
 * @param packId - Id of a user pack.
 */
export function encodePackShare(packId: string): string {
	return `${PREFIX}${packId}`;
}

/**
 * Recognises a pack share in a text message.
 *
 * @param text - Decrypted text of a `text` message.
 * @returns the pack id when the entire message (ignoring surrounding whitespace) is a share token, else null.
 */
export function parsePackShare(text: string | undefined): string | null {
	if (!text) return null;
	const trimmed = text.trim();
	if (!trimmed.startsWith(PREFIX)) return null;
	const id = trimmed.slice(PREFIX.length);
	return PACK_ID.test(id) ? id : null;
}
