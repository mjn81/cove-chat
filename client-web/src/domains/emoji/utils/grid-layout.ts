/**
 * Layout maths for the virtualised emoji grid. Each category is a section whose height is known up front from the
 * column count, so off-screen sections can be empty placeholders of exactly the right size: scrolling, the sticky
 * headings and scroll-to-category all behave as if everything were rendered.
 */

/** How many cells fit in a row of the given width (at least 1). */
export function columnsFor(width: number, cell: number): number {
	return Math.max(1, Math.floor(width / cell));
}

/**
 * Height of a section's cell area.
 *
 * @param count - Number of cells.
 * @param cols - Cells per row.
 * @param cell - Cell height in px.
 */
export function gridHeight(count: number, cols: number, cell: number): number {
	return Math.ceil(count / Math.max(1, cols)) * cell;
}
