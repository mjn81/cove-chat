/**
 * Client side of the paged-list envelope (docs/api-standard.md section 9): `{ items, next_cursor }`.
 */

/** One page of a paged list. `next_cursor` is empty or absent on the last page. */
export interface Page<T> {
	items: T[];
	next_cursor?: string;
}

/** Page size used when a client wants as few round trips as possible (the server maximum). */
export const MAX_PAGE_LIMIT = 100;

/**
 * Safe accessor for a page's items.
 *
 * @param page - A page as received from the server (or nothing).
 * @returns The items, or an empty array when the page or its `items` is missing/null.
 */
export function pageItems<T>(page: Page<T> | null | undefined): T[] {
	return page?.items ?? [];
}

/**
 * Loads every page of a paged list and concatenates the items. Use it for lists the UI needs in full (my channels,
 * relationships, channel members); scrollable or unbounded lists use `useInfiniteQuery` instead.
 *
 * @param fetchPage - Fetches one page; receives the previous page's `next_cursor`, `undefined` for the first page.
 * @param maxPages - Safety bound against a server that never ends the cursor chain.
 * @returns All items in server order.
 * @throws Whatever `fetchPage` throws; a partial list is never returned.
 */
export async function fetchAllPages<T>(
	fetchPage: (cursor?: string) => Promise<Page<T>>,
	maxPages = 200,
): Promise<T[]> {
	const all: T[] = [];
	let cursor: string | undefined;
	for (let i = 0; i < maxPages; i++) {
		const page = await fetchPage(cursor);
		all.push(...pageItems(page));
		if (!page?.next_cursor) break;
		cursor = page.next_cursor;
	}
	return all;
}
