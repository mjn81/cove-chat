/** Message types this build knows how to render. Anything else is shown as a placeholder (docs/api-standard.md section 5). */
export const KNOWN_MESSAGE_TYPES = ['text', 'file', 'voice', 'video', 'invite'] as const;

/**
 * Whether a message type from the server is one this client can render. A newer server may introduce types an
 * older client has never seen; those must degrade to a placeholder card, not crash or vanish.
 *
 * @param type - The `type` field of a message.
 */
export function isKnownMessageType(type: string): boolean {
	return (KNOWN_MESSAGE_TYPES as readonly string[]).includes(type);
}
