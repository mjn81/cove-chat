import { describe, expect, it } from 'vitest';
import { isBeforeDay, minuteOptions, pickDay, withTime } from './date-time';

describe('date-time helpers', () => {
	it('withTime replaces the time and zeroes seconds', () => {
		const d = withTime(new Date(2026, 5, 1, 9, 30, 45, 500), 18, 15);
		expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([18, 15, 0, 0]);
		expect(d.getDate()).toBe(1);
	});

	it('pickDay keeps the previous time of day', () => {
		const picked = pickDay(new Date(2026, 6, 4), new Date(2026, 5, 1, 7, 45));
		expect([picked.getMonth(), picked.getDate(), picked.getHours(), picked.getMinutes()]).toEqual([6, 4, 7, 45]);
	});

	it('pickDay uses the fallback time when nothing was chosen yet', () => {
		const picked = pickDay(new Date(2026, 6, 4), undefined, [23, 0]);
		expect([picked.getHours(), picked.getMinutes()]).toEqual([23, 0]);
	});

	it('minuteOptions steps by five and keeps an off-step current value', () => {
		expect(minuteOptions(undefined)).toHaveLength(12);
		expect(minuteOptions(17)).toContain(17);
		expect(minuteOptions(17).indexOf(17)).toBe(minuteOptions(17).indexOf(15) + 1);
	});

	it('isBeforeDay compares days, not times', () => {
		const min = new Date(2026, 5, 10, 15, 0);
		expect(isBeforeDay(new Date(2026, 5, 10, 1, 0), min)).toBe(false);
		expect(isBeforeDay(new Date(2026, 5, 9, 23, 59), min)).toBe(true);
	});
});
