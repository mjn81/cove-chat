/**
 * Remembers the opaque `next_cursor` of each loaded message page.
 *
 * The chat cache stores plain arrays of messages per page and the WebSocket handlers edit those arrays in place, so
 * the cursor cannot live inside the page. It is keyed by channel and the id of the page's oldest message instead: that
 * is the one message that identifies "the end of what is loaded", and the server's next page starts right after it.
 */

const cursors = new Map<string, string>();

const keyOf = (channelId: string, oldestId: string) => `${channelId}:${oldestId}`;

/** A message page is newest-first, so its last element is the oldest. */
function oldestId(page: ReadonlyArray<{ id: string }>): string | undefined {
	return page.length > 0 ? page[page.length - 1].id : undefined;
}

/**
 * Records the cursor that leads to the page after `page`.
 *
 * @param channelId - Channel the page belongs to.
 * @param page - The page just fetched, newest first.
 * @param nextCursor - The server's `next_cursor`; empty/undefined means this was the last page and nothing is stored.
 */
export function rememberMessageCursor(
	channelId: string,
	page: ReadonlyArray<{ id: string }>,
	nextCursor: string | undefined,
): void {
	const id = oldestId(page);
	if (id && nextCursor) cursors.set(keyOf(channelId, id), nextCursor);
}

/**
 * Looks up the cursor for the page after `lastPage`.
 *
 * @returns The cursor, or `undefined` when there is no older page.
 */
export function nextMessageCursor(
	channelId: string,
	lastPage: ReadonlyArray<{ id: string }>,
): string | undefined {
	const id = oldestId(lastPage);
	return id ? cursors.get(keyOf(channelId, id)) : undefined;
}

/** Forgets every remembered cursor (sign-out; tests). */
export function clearMessageCursors(): void {
	cursors.clear();
}
