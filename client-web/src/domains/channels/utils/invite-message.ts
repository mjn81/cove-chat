/** Body of an `invite` message: what the receiving card shows before the user decides to join. */
export interface InviteBody {
	/** Channel invite code, the same one `GET /api/join/{code}` resolves. */
	code: string;
	/** Channel name at the time of sharing; the card loads fresh details from the server when it can. */
	name?: string;
	avatar_id?: string;
}

/** The characters an invite code can contain (matches the `/join/<code>` rule used everywhere else). */
const CODE_PATTERN = /^[a-zA-Z0-9-]+$/;

/**
 * Serialises an invite for a message body (the text that gets encrypted).
 *
 * @param body - The invite to share.
 */
export function encodeInvite(body: InviteBody): string {
	return JSON.stringify(body);
}

/**
 * Reads the text of an `invite` message back into an {@link InviteBody}.
 *
 * @param text - Decrypted message text.
 * @returns the invite, or null when the text is not a valid invite (the card then falls back to plain text).
 */
export function parseInvite(text: string): InviteBody | null {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
	const { code, name, avatar_id } = data as Record<string, unknown>;
	if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return null;
	const invite: InviteBody = { code };
	if (typeof name === 'string') invite.name = name;
	if (typeof avatar_id === 'string') invite.avatar_id = avatar_id;
	return invite;
}

/**
 * The link for "Copy invite", for sharing outside Cove. It is never shown to the user.
 *
 * In a browser the page is served by the Cove server, so its origin is right. The desktop app's page origin is the
 * app itself, so it must use the server the user signed in to.
 *
 * @param code - Channel invite code.
 * @param where - Where the app runs and which origins apply.
 */
export function buildInviteUrl(
	code: string,
	where: { desktop: boolean; serverUrl: string; origin: string },
): string {
	const base = where.desktop ? where.serverUrl : where.origin;
	return `${base.replace(/\/$/, '')}/join/${code}`;
}
