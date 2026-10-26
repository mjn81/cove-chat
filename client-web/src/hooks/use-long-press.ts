import { useCallback, useEffect, useRef } from 'react';

interface LongPressOptions {
	/** Hold time in ms before the press counts. */
	delay?: number;
	/** Pointer travel in px that cancels the press (the user is scrolling or selecting). */
	moveTolerance?: number;
}

/**
 * Detects a press-and-hold on an element (mouse or touch).
 *
 * Spread the returned handlers onto the element. After a long press fires, the click that the browser
 * dispatches on release is swallowed so a pressed link/button is not also activated, and the native
 * context menu is suppressed (Android raises it on long touch).
 *
 * @param onLongPress - Called with the element that was pressed (use `closest()` to find a link inside).
 * @param options - Delay and movement tolerance.
 * @returns Pointer/click handlers for the target element.
 */
export function useLongPress(onLongPress: (target: EventTarget | null) => void, options: LongPressOptions = {}) {
	const { delay = 500, moveTolerance = 10 } = options;
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);
	const fired = useRef(false);
	const callback = useRef(onLongPress);
	useEffect(() => {
		callback.current = onLongPress;
	}, [onLongPress]);

	const cancel = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		origin.current = null;
	}, []);

	useEffect(() => cancel, [cancel]);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (e.button !== 0) return;
			fired.current = false;
			origin.current = { x: e.clientX, y: e.clientY };
			const target = e.target;
			timer.current = setTimeout(() => {
				fired.current = true;
				timer.current = null;
				callback.current(target);
			}, delay);
		},
		[delay],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const o = origin.current;
			if (!o || !timer.current) return;
			if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > moveTolerance) cancel();
		},
		[cancel, moveTolerance],
	);

	const onClickCapture = useCallback((e: React.MouseEvent) => {
		if (!fired.current) return;
		fired.current = false;
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const onContextMenu = useCallback((e: React.MouseEvent) => {
		if (fired.current) e.preventDefault();
	}, []);

	return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel, onClickCapture, onContextMenu };
}
