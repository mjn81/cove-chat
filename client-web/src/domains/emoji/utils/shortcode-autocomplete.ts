import type { CustomEmojiItem } from '../types/emoji.types';

/** An in-progress `:name` the user is typing. */
export interface ShortcodeQuery {
	/** Index of the opening colon in the text. */
	start: number;
	/** What follows the colon so far (may be empty only when `minLength` is 0). */
	query: string;
}

/** Characters typed after the colon before the popup opens, so ":)" and "10:30" do not trigger it. */
export const SHORTCODE_MIN_QUERY = 2;

/**
 * Finds the `:query` immediately before the cursor, if the user is in the middle of typing a shortcode.
 * The colon must start the text or follow whitespace, and only shortcode characters may follow it.
 *
 * @param text - Composer text.
 * @param cursor - Caret position.
 */
export function findShortcodeQuery(text: string, cursor: number): ShortcodeQuery | null {
	const before = text.slice(0, cursor);
	const m = /(?:^|\s):([a-z0-9_]{0,32})$/.exec(before);
	if (!m || m[1].length < SHORTCODE_MIN_QUERY) return null;
	return { start: before.length - m[1].length - 1, query: m[1] };
}

/**
 * Replaces the typed `:query` with the finished `:name: `.
 *
 * @param text - Composer text.
 * @param cursor - Caret position.
 * @param name - The chosen custom emoji name.
 * @returns The new text and where the caret goes.
 */
export function applyShortcode(text: string, cursor: number, name: string): { text: string; cursor: number } {
	const q = findShortcodeQuery(text, cursor);
	if (!q) return { text, cursor };
	const inserted = `:${name}: `;
	const next = text.slice(0, q.start) + inserted + text.slice(cursor);
	return { text: next, cursor: q.start + inserted.length };
}

/**
 * Custom emoji matching a query: names starting with it first, then names containing it, each alphabetical.
 *
 * @param items - The server's custom emoji.
 * @param query - Text typed after the colon.
 * @param limit - Most results.
 */
export function filterCustomEmoji(items: readonly CustomEmojiItem[], query: string, limit = 8): CustomEmojiItem[] {
	const q = query.toLowerCase();
	const starts: CustomEmojiItem[] = [];
	const contains: CustomEmojiItem[] = [];
	for (const item of items) {
		if (item.name.startsWith(q)) starts.push(item);
		else if (item.name.includes(q)) contains.push(item);
	}
	const byName = (a: CustomEmojiItem, b: CustomEmojiItem) => a.name.localeCompare(b.name);
	return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit);
}
