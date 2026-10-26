import { describe, expect, it } from 'vitest';

import { clampTrimEnd, clampTrimStart, isTrimmed, pointerToSeconds } from './trim';

describe('trim helpers', () => {
	it('isTrimmed ignores sub-0.1s differences', () => {
		expect(isTrimmed(10, 0.05, 9.95)).toBe(false);
		expect(isTrimmed(10, 0.2, 10)).toBe(true);
		expect(isTrimmed(10, 0, 9.5)).toBe(true);
	});

	it('keeps at least half a second between the handles', () => {
		expect(clampTrimStart(9, 5)).toBe(4.5);
		expect(clampTrimStart(-3, 5)).toBe(0);
		expect(clampTrimEnd(1, 2, 10)).toBe(2.5);
		expect(clampTrimEnd(99, 2, 10)).toBe(10);
	});

	it('converts a pointer x position to seconds, clamped to the timeline', () => {
		const rect = { left: 100, right: 300, width: 200 };
		expect(pointerToSeconds(200, rect, 10)).toBe(5);
		expect(pointerToSeconds(50, rect, 10)).toBe(0);
		expect(pointerToSeconds(999, rect, 10)).toBe(10);
	});
});
