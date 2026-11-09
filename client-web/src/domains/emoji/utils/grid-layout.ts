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

/** Narrowest and widest emoji grids: a phone-width "column mode" and a wide desktop layout. */
export const MIN_PICKER_COLUMNS = 5;
export const MAX_PICKER_COLUMNS = 12;
/** Target cell width in px; columns are whatever fits, then share the full width equally. */
export const PICKER_CELL_WIDTH = 40;

/**
 * Emoji grid columns for the panel's measured content width, so the grid adapts to a narrow column or a wide window
 * instead of using a fixed count.
 *
 * @param width - Measured width of the scroll area; 0 before the first measurement (a sensible default is used).
 */
export function pickerColumns(width: number): number {
	if (width <= 0) return 9;
	return Math.min(MAX_PICKER_COLUMNS, Math.max(MIN_PICKER_COLUMNS, Math.floor(width / PICKER_CELL_WIDTH)));
}

/** Sticker grid columns: 3 in a narrow column, 4 at the standard width, more when wide; cells are equal and fill the row. */
export function stickerColumns(width: number): number {
	if (width <= 0) return 4;
	return Math.min(6, Math.max(3, Math.floor(width / 84)));
}
