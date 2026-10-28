import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Track the content-box size of an element with a ResizeObserver.
 *
 * @returns a ref to attach to the element and its current `{ width, height }` (zeros until first measured)
 */
export function useElementSize<T extends HTMLElement>() {
	const ref = useRef<T | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = () => {
				// clientWidth/Height include padding; callers lay content out inside it, so subtract it.
				const cs = getComputedStyle(el);
				const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
				const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
				setSize({
					width: Math.max(0, el.clientWidth - padX),
					height: Math.max(0, el.clientHeight - padY),
				});
			};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return [ref, size] as const;
}
