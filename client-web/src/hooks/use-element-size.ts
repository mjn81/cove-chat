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
		const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return [ref, size] as const;
}
