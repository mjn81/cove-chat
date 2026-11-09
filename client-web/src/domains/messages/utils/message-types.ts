/** Message types this build knows how to render. Anything else is shown as a placeholder (docs/api-standard.md section 5). */
export const KNOWN_MESSAGE_TYPES = ['text', 'file', 'voice', 'video', 'invite', 'sticker'] as const;

/**
 * Whether a message type from the server is one this client can render. A newer server may introduce types an
 * older client has never seen; those must degrade to a placeholder card, not crash or vanish.
 *
 * @param type - The `type` field of a message.
 */
export function isKnownMessageType(type: string): boolean {
	return (KNOWN_MESSAGE_TYPES as readonly string[]).includes(type);
}

/** Types whose decrypted body is read as text: the message text itself, or the JSON of an invite or sticker. */
const TEXT_BODY_TYPES = new Set(['text', 'invite', 'sticker']);

/**
 * Whether the message list decrypts this message up front (its body is text). File, voice and video messages
 * decrypt their bytes lazily instead.
 *
 * @param type - The `type` field of a message.
 */
export function hasTextBody(type: string): boolean {
	return TEXT_BODY_TYPES.has(type);
}
