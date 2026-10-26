import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useLongPress } from './use-long-press';

const down = (x = 0, y = 0, target: EventTarget = document.body) =>
	({ button: 0, clientX: x, clientY: y, target }) as unknown as React.PointerEvent;

describe('useLongPress', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fires after the delay and passes the pressed element', () => {
		const onLongPress = vi.fn();
		const { result } = renderHook(() => useLongPress(onLongPress, { delay: 500 }));
		const el = document.createElement('a');
		act(() => result.current.onPointerDown(down(0, 0, el)));
		act(() => void vi.advanceTimersByTime(499));
		expect(onLongPress).not.toHaveBeenCalled();
		act(() => void vi.advanceTimersByTime(1));
		expect(onLongPress).toHaveBeenCalledWith(el);
	});

	it('does not fire when released early', () => {
		const onLongPress = vi.fn();
		const { result } = renderHook(() => useLongPress(onLongPress));
		act(() => result.current.onPointerDown(down()));
		act(() => result.current.onPointerUp());
		act(() => void vi.advanceTimersByTime(1000));
		expect(onLongPress).not.toHaveBeenCalled();
	});

	it('cancels when the pointer moves beyond the tolerance (scrolling)', () => {
		const onLongPress = vi.fn();
		const { result } = renderHook(() => useLongPress(onLongPress, { moveTolerance: 10 }));
		act(() => result.current.onPointerDown(down(0, 0)));
		act(() => result.current.onPointerMove({ clientX: 3, clientY: 3 } as React.PointerEvent));
		act(() => void vi.advanceTimersByTime(600));
		expect(onLongPress).toHaveBeenCalledTimes(1);

		const second = vi.fn();
		const r2 = renderHook(() => useLongPress(second, { moveTolerance: 10 }));
		act(() => r2.result.current.onPointerDown(down(0, 0)));
		act(() => r2.result.current.onPointerMove({ clientX: 30, clientY: 0 } as React.PointerEvent));
		act(() => void vi.advanceTimersByTime(600));
		expect(second).not.toHaveBeenCalled();
	});

	it('swallows the click that follows a long press so a pressed link does not open', () => {
		const { result } = renderHook(() => useLongPress(vi.fn()));
		act(() => result.current.onPointerDown(down()));
		act(() => void vi.advanceTimersByTime(600));
		const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;
		result.current.onClickCapture(e);
		expect(e.preventDefault).toHaveBeenCalled();
		const next = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;
		result.current.onClickCapture(next);
		expect(next.preventDefault).not.toHaveBeenCalled();
	});

	it('ignores non-primary buttons', () => {
		const onLongPress = vi.fn();
		const { result } = renderHook(() => useLongPress(onLongPress));
		act(() => result.current.onPointerDown({ ...down(), button: 2 } as unknown as React.PointerEvent));
		act(() => void vi.advanceTimersByTime(600));
		expect(onLongPress).not.toHaveBeenCalled();
	});
});
