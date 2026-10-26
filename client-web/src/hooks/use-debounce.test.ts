import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useDebounce } from './use-debounce';

describe('useDebounce', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('returns the initial value immediately', () => {
		const { result } = renderHook(() => useDebounce('a', 300));
		expect(result.current).toBe('a');
	});

	it('only emits the latest value after the quiet period', () => {
		const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
			initialProps: { v: 'a' },
		});

		rerender({ v: 'ab' });
		act(() => {
			vi.advanceTimersByTime(200);
		});
		rerender({ v: 'abc' });
		act(() => {
			vi.advanceTimersByTime(299);
		});
		expect(result.current).toBe('a');

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current).toBe('abc');
	});
});
