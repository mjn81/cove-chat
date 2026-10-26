/**
 * Moves `index` by `step` inside a list of `total` items, wrapping around.
 * Used for arrow-key navigation in galleries and result lists.
 *
 * @param index - Current position.
 * @param step - `-1` for previous, `1` for next.
 * @param total - Number of items; lists of 0 or 1 always return 0.
 */
export function wrapIndex(index: number, step: number, total: number): number {
	if (total <= 1) return 0;
	return (index + step + total) % total;
}
