/**
 * Returns a copy of `ids` with the element at `from` moved to position `to` (drag-and-drop and the arrow buttons).
 * Out-of-range indexes return the list unchanged.
 *
 * @param ids - Item ids in their current order.
 * @param from - Index of the item to move.
 * @param to - Destination index.
 */
export function moveItem<T>(ids: readonly T[], from: number, to: number): T[] {
	const next = [...ids];
	if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
