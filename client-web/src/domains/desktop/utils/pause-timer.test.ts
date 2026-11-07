import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PauseTimer } from './pause-timer';

describe('PauseTimer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fires after its duration', () => {
		const done = vi.fn();
		new PauseTimer(1000, done).start();
		vi.advanceTimersByTime(999);
		expect(done).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(done).toHaveBeenCalledOnce();
	});

	it('keeps the remaining time while paused', () => {
		const done = vi.fn();
		const t = new PauseTimer(1000, done);
		t.start();
		vi.advanceTimersByTime(600);
		t.pause();
		vi.advanceTimersByTime(10_000);
		expect(done).not.toHaveBeenCalled();
		t.start();
		vi.advanceTimersByTime(399);
		expect(done).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(done).toHaveBeenCalledOnce();
	});

	it('does nothing after cancel', () => {
		const done = vi.fn();
		const t = new PauseTimer(100, done);
		t.start();
		t.cancel();
		vi.advanceTimersByTime(500);
		expect(done).not.toHaveBeenCalled();
	});
});
