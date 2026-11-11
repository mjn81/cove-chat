import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

type Listener = () => void;

/** A controllable matchMedia: counts how many lists and listeners the code under test creates. */
function installMatchMedia(initial: boolean) {
	let matches = initial;
	const listeners = new Set<Listener>();
	const addEventListener = vi.fn((_: string, l: Listener) => listeners.add(l));
	const removeEventListener = vi.fn((_: string, l: Listener) => listeners.delete(l));
	const matchMedia = vi.fn((query: string) => ({
		media: query,
		get matches() {
			return matches;
		},
		addEventListener,
		removeEventListener,
	}));
	vi.stubGlobal('matchMedia', matchMedia);
	window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
	return {
		matchMedia,
		addEventListener,
		listeners,
		set(next: boolean) {
			matches = next;
			listeners.forEach((l) => l());
		},
	};
}

describe('useMediaQuery', () => {
	beforeEach(() => vi.unstubAllGlobals());
	afterEach(() => vi.unstubAllGlobals());

	it('reflects the current match and follows changes', () => {
		const mm = installMatchMedia(false);
		const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'));
		expect(result.current).toBe(false);
		act(() => mm.set(true));
		expect(result.current).toBe(true);
	});

	it('shares one MediaQueryList and one listener between every component using a query', () => {
		const mm = installMatchMedia(true);
		// A chat page renders this hook once per visible message row.
		const hooks = Array.from({ length: 100 }, () => renderHook(() => useMediaQuery('(max-width: 640px)')));
		expect(hooks.every((h) => h.result.current)).toBe(true);
		expect(mm.addEventListener).toHaveBeenCalledTimes(1);
		// Not one new MediaQueryList per read either (it used to be created on every snapshot).
		expect(mm.matchMedia.mock.calls.length).toBeLessThanOrEqual(3);

		hooks.forEach((h) => h.unmount());
		expect(mm.listeners.size).toBe(0);
	});
});
