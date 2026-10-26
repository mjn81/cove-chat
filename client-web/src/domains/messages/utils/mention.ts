/** A channel member that can be @-mentioned. */
export interface MentionMember {
	id: string;
	username: string;
}

/**
 * Finds the @mention the cursor is currently typing.
 *
 * An `@` only starts a mention at the beginning of the text or after a space,
 * so e-mail addresses (`a@b`) do not open the picker; the mention ends at the
 * first space.
 *
 * @param value - Full textarea value.
 * @param cursor - Caret position.
 * @returns The text typed after the `@` (possibly empty), or `null` if the caret is not in a mention.
 */
export function detectMention(value: string, cursor: number): string | null {
	const before = value.substring(0, cursor);
	const lastAt = before.lastIndexOf('@');
	if (lastAt === -1) return null;
	if (lastAt !== 0 && before[lastAt - 1] !== ' ') return null;
	const query = before.substring(lastAt + 1);
	return query.includes(' ') ? null : query;
}

/**
 * Replaces the partial mention before the caret with `@username ` and
 * returns where the caret should go.
 *
 * @param text - Full textarea value.
 * @param cursor - Caret position inside the partial mention.
 * @param username - Member picked from the list.
 */
export function applyMention(
	text: string,
	cursor: number,
	username: string,
): { text: string; cursor: number } {
	const before = text.substring(0, cursor);
	const after = text.substring(cursor);
	const lastAt = before.lastIndexOf('@');
	return {
		text: `${before.substring(0, lastAt)}@${username} ${after}`,
		cursor: lastAt + username.length + 2,
	};
}

/**
 * Members matching the typed mention, excluding the current user.
 *
 * @param members - Channel members.
 * @param selfId - Current user's id.
 * @param query - Text after the `@`; `null` shows everyone.
 */
export function filterMentionMembers(
	members: MentionMember[],
	selfId: string | undefined,
	query: string | null,
): MentionMember[] {
	const needle = query?.toLowerCase() || '';
	return members.filter((m) => m.id !== selfId && m.username.toLowerCase().includes(needle));
}
