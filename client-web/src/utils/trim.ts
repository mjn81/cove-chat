/** Handles must stay at least this far apart (seconds) so a trim can never collapse to nothing. */
const MIN_TRIM_GAP = 0.5;

/** Whether the trim handles cut off a meaningful amount (more than 0.1 s) from either end. */
export function isTrimmed(total: number, start: number, end: number): boolean {
	return start > 0.1 || total - end > 0.1;
}

/** New start handle position: not below 0 and not within half a second of the end handle. */
export function clampTrimStart(target: number, end: number): number {
	return Math.max(0, Math.min(target, end - MIN_TRIM_GAP));
}

/** New end handle position: not beyond the recording and not within half a second of the start handle. */
export function clampTrimEnd(target: number, start: number, total: number): number {
	return Math.min(total, Math.max(target, start + MIN_TRIM_GAP));
}

/**
 * Maps a pointer's x coordinate to a time on a trim timeline.
 *
 * @param clientX - Pointer position.
 * @param rect - Bounding box of the timeline element.
 * @param total - Recording length in seconds.
 */
export function pointerToSeconds(
	clientX: number,
	rect: { left: number; right: number; width: number },
	total: number,
): number {
	const x = Math.max(rect.left, Math.min(rect.right, clientX));
	return ((x - rect.left) / rect.width) * total;
}
