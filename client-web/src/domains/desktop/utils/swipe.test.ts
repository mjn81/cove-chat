import { describe, expect, it } from 'vitest';

import { DRAG_START_PX, dragOpacity, isDrag, swipeOutcome } from './swipe';

describe('isDrag', () => {
	it('separates a click from a drag', () => {
		expect(isDrag(DRAG_START_PX - 1)).toBe(false);
		expect(isDrag(-DRAG_START_PX)).toBe(true);
	});
});

describe('swipeOutcome', () => {
	it('dismisses past 40% of the width in either direction', () => {
		expect(swipeOutcome(150, 360, 800)).toBe('dismiss');
		expect(swipeOutcome(-150, 360, 800)).toBe('dismiss');
	});
	it('springs back for a short slow drag', () => {
		expect(swipeOutcome(100, 360, 800)).toBe('return');
		expect(swipeOutcome(-30, 360, 1000)).toBe('return');
	});
	it('dismisses a quick flick even when short', () => {
		expect(swipeOutcome(60, 360, 80)).toBe('dismiss');
		expect(swipeOutcome(-60, 360, 80)).toBe('dismiss');
	});
	it('ignores a flick that barely moved', () => {
		expect(swipeOutcome(10, 360, 5)).toBe('return');
	});
	it('copes with a zero duration or width', () => {
		expect(swipeOutcome(80, 360, 0)).toBe('dismiss');
		expect(swipeOutcome(5, 0, 100)).toBe('return');
	});
});

describe('dragOpacity', () => {
	it('falls off with distance and is symmetrical', () => {
		expect(dragOpacity(0, 360)).toBe(1);
		expect(dragOpacity(180, 360)).toBeCloseTo(0.5);
		expect(dragOpacity(-180, 360)).toBeCloseTo(0.5);
		expect(dragOpacity(999, 360)).toBe(0);
	});
});
