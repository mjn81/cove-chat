/** A rectangle in viewport coordinates. */
export interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface Placement {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Margin kept between the panel and the window edges, and between the panel and its button. */
export const EDGE = 8;

/**
 * Where to put a floating panel relative to its button, in fixed (viewport) coordinates. The panel sits above the
 * button, aligned to its end edge, and flips below when there is no room above; it is clamped inside the window and
 * shrinks (never overflows) in small windows. Because the panel is fixed-positioned and rendered outside the
 * composer, opening it can never push or resize the composer or the chat layout.
 *
 * @param anchor - The button's rectangle.
 * @param viewport - Window inner size.
 * @param size - Preferred panel size.
 * @param rtl - Align to the button's start edge (left) instead of its end edge.
 */
export function placePanel(anchor: Box, viewport: { width: number; height: number }, size: { width: number; height: number }, rtl = false): Placement {
	const width = Math.min(size.width, viewport.width - EDGE * 2);
	const above = anchor.top - EDGE * 2;
	const below = viewport.height - anchor.bottom - EDGE * 2;
	const placeAbove = above >= Math.min(size.height, 320) || above >= below;
	const room = placeAbove ? above : below;
	const height = Math.max(240, Math.min(size.height, room));
	const top = placeAbove ? anchor.top - EDGE - height : anchor.bottom + EDGE;
	const wanted = rtl ? anchor.left : anchor.right - width;
	const left = Math.min(Math.max(wanted, EDGE), viewport.width - width - EDGE);
	return { left, top: Math.max(EDGE, top), width, height };
}
