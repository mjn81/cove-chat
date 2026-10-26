/** Words for the two relative day names, already translated by the caller. */
export interface DayLabels {
	today: string;
	yesterday: string;
}

/**
 * Day heading for a message list: "Today", "Yesterday", otherwise a short
 * localized date ("Wed, Oct 21"). The year is only added for dates outside
 * the current year.
 *
 * @param value - ISO string, epoch milliseconds, or Date.
 * @param labels - Translated "today"/"yesterday".
 * @param now - Injectable clock for tests.
 */
export function formatDayLabel(
	value: string | number | Date,
	labels: DayLabels,
	now: Date = new Date(),
): string {
	const d = new Date(value);
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (d.toDateString() === now.toDateString()) return labels.today;
	if (d.toDateString() === yesterday.toDateString()) return labels.yesterday;
	return d.toLocaleDateString([], {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
	});
}

/** Localized clock time such as "09:41" (respecting the user's 12/24h setting). */
export function formatClockTime(value: string | number | Date): string {
	return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Compact countdown to an expiry timestamp: `42s`, `5m`, `3h`.
 *
 * @param expiresAt - Epoch ms, or `null` for messages that never expire.
 * @param now - Current epoch ms.
 * @param expiredLabel - Translated text shown once the time has passed.
 * @returns `null` when there is no expiry.
 */
export function formatCountdown(
	expiresAt: number | null,
	now: number,
	expiredLabel: string,
): string | null {
	if (!expiresAt) return null;
	const diffMs = expiresAt - now;
	if (diffMs <= 0) return expiredLabel;
	const totalSec = Math.floor(diffMs / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const mins = Math.floor(totalSec / 60);
	if (mins < 60) return `${mins}m`;
	return `${Math.floor(mins / 60)}h`;
}
