/** Horizontal distance in px before a pointer press counts as a drag rather than a click. */
export const DRAG_START_PX = 6;
/** A release past this share of the card's width dismisses it. */
export const SWIPE_DISMISS_FRACTION = 0.4;
/** A quicker flick than this (px per ms) dismisses it, if it also travelled at least FLICK_MIN_PX. */
export const FLICK_VELOCITY = 0.5;
/** The least distance in px a flick must cover to count. */
export const FLICK_MIN_PX = 24;

/** What happens when the pointer is released after a drag. */
export type SwipeOutcome = 'dismiss' | 'return';

/** True once a press has moved far enough to be a drag, so the click that follows must be ignored. */
export function isDrag(dx: number): boolean {
	return Math.abs(dx) >= DRAG_START_PX;
}

/**
 * Decides whether a released drag dismisses the card (dragged past 40% of its width, or flicked quickly) or lets
 * it spring back.
 *
 * @param dx - horizontal travel in px (sign gives the direction).
 * @param width - the card's width in px.
 * @param durationMs - how long the drag lasted.
 */
export function swipeOutcome(dx: number, width: number, durationMs: number): SwipeOutcome {
	const distance = Math.abs(dx);
	if (width > 0 && distance >= width * SWIPE_DISMISS_FRACTION) return 'dismiss';
	const velocity = distance / Math.max(durationMs, 1);
	return distance >= FLICK_MIN_PX && velocity >= FLICK_VELOCITY ? 'dismiss' : 'return';
}

/** Opacity of a card dragged dx px: it fades out as it nears a full width away. */
export function dragOpacity(dx: number, width: number): number {
	if (width <= 0) return 1;
	return Math.max(0, 1 - Math.abs(dx) / width);
}
