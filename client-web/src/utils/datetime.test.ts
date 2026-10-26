import { describe, expect, it } from 'vitest';

import { formatCountdown, formatDayLabel } from './datetime';

const labels = { today: 'Today', yesterday: 'Yesterday' };
// Noon avoids any timezone edge cases around midnight.
const NOW = new Date(2026, 9, 26, 12, 0, 0);

describe('formatDayLabel', () => {
	it('labels today and yesterday with the supplied (translated) words', () => {
		expect(formatDayLabel(new Date(2026, 9, 26, 8, 0), labels, NOW)).toBe('Today');
		expect(formatDayLabel(new Date(2026, 9, 25, 23, 0), labels, NOW)).toBe('Yesterday');
	});

	it('accepts ISO strings and epoch milliseconds', () => {
		expect(formatDayLabel(new Date(2026, 9, 26, 9, 0).toISOString(), labels, NOW)).toBe('Today');
		expect(formatDayLabel(new Date(2026, 9, 25, 9, 0).getTime(), labels, NOW)).toBe('Yesterday');
	});

	it('uses a short date for older days and only adds the year outside the current year', () => {
		const thisYear = formatDayLabel(new Date(2026, 0, 5), labels, NOW);
		const lastYear = formatDayLabel(new Date(2025, 0, 5), labels, NOW);
		expect(thisYear).not.toMatch(/2026/);
		expect(lastYear).toMatch(/2025/);
	});
});

describe('formatCountdown', () => {
	const now = 1_000_000;

	it('is null when there is no expiry', () => {
		expect(formatCountdown(null, now, 'Expired')).toBeNull();
	});

	it('says expired once the time has passed', () => {
		expect(formatCountdown(now - 1, now, 'Expired')).toBe('Expired');
		expect(formatCountdown(now, now, 'Expired')).toBe('Expired');
	});

	it('shows the largest whole unit', () => {
		expect(formatCountdown(now + 42_000, now, 'Expired')).toBe('42s');
		expect(formatCountdown(now + 5 * 60_000 + 59_000, now, 'Expired')).toBe('5m');
		expect(formatCountdown(now + 3 * 3_600_000 + 10 * 60_000, now, 'Expired')).toBe('3h');
	});
});
