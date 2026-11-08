/**
 * Inserts text into a composer value at the caret, replacing any selection. The value stays plain Unicode: an emoji
 * is inserted as its real character (or a `:name:` shortcode), never as markup or a placeholder.
 *
 * @param value - Current textarea value.
 * @param start - `selectionStart` (clamped into the value).
 * @param end - `selectionEnd`.
 * @param insert - Text to insert.
 * @returns the new value and where the caret goes (just after the inserted text).
 */
export function insertAtSelection(
	value: string,
	start: number | null | undefined,
	end: number | null | undefined,
	insert: string,
): { text: string; caret: number } {
	const clamp = (n: number | null | undefined) => Math.min(Math.max(n ?? value.length, 0), value.length);
	const a = clamp(start);
	const b = Math.max(a, clamp(end));
	return { text: value.slice(0, a) + insert + value.slice(b), caret: a + insert.length };
}

/** Keys the emoji grid handles itself. */
export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/**
 * Next focused cell for a horizontal key press in a flat list of cells; Left and Right swap in right-to-left layouts.
 *
 * @param index - Currently focused cell.
 * @param count - Number of cells.
 * @param key - The pressed key.
 * @param rtl - Whether the layout is right-to-left.
 */
export function stepIndex(index: number, count: number, key: GridKey, rtl: boolean): number {
	if (count <= 0) return -1;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	const forward = (key === 'ArrowRight') !== rtl;
	return Math.min(Math.max(index + (forward ? 1 : -1), 0), count - 1);
}
