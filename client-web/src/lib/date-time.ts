/**
 * Returns a copy of `date` with its time of day replaced.
 *
 * @param date - Calendar day to keep (its own time is discarded).
 * @param hours - 0-23.
 * @param minutes - 0-59.
 */
export function withTime(date: Date, hours: number, minutes: number): Date {
	const next = new Date(date);
	next.setHours(hours, minutes, 0, 0);
	return next;
}

/**
 * Picks a day on the calendar while keeping the time already chosen.
 * Without a previous value the time defaults to `fallback` (end of the working day
 * is a sensible default for expiry dates).
 *
 * @param day - The day clicked in the calendar.
 * @param previous - The current value, if any.
 * @param fallback - `[hours, minutes]` used when nothing was picked yet.
 */
export function pickDay(
	day: Date,
	previous: Date | undefined,
	fallback: readonly [number, number] = [12, 0],
): Date {
	const [h, m] = previous ? [previous.getHours(), previous.getMinutes()] : fallback;
	return withTime(day, h, m);
}

/**
 * Minutes offered by the time selector: every `step` minutes, plus the
 * current minute when it falls between steps so an existing value stays selectable.
 */
export function minuteOptions(current: number | undefined, step = 5): number[] {
	const out: number[] = [];
	for (let m = 0; m < 60; m += step) out.push(m);
	if (current !== undefined && !out.includes(current)) {
		out.push(current);
		out.sort((a, b) => a - b);
	}
	return out;
}

/** True when `date` is strictly before the start of `min`'s day. */
export function isBeforeDay(date: Date, min: Date): boolean {
	const a = new Date(date);
	a.setHours(0, 0, 0, 0);
	const b = new Date(min);
	b.setHours(0, 0, 0, 0);
	return a.getTime() < b.getTime();
}
