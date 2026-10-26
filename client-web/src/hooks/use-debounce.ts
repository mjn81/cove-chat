import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has stopped changing for `delay` ms. Use it for
 * every input that triggers a request (search boxes, availability checks).
 *
 * @param value - The fast-changing value, e.g. the text in a search box.
 * @param delay - Quiet period in milliseconds before the new value is emitted.
 * @returns The debounced value; equals `value` on first render.
 * @example
 * const debouncedQuery = useDebounce(query.trim(), 300);
 * const { data } = useUserSearch(debouncedQuery);
 */
export function useDebounce<T>(value: T, delay = 300): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}
