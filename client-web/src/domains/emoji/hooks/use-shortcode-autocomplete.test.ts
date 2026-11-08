import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const items = [
	{ name: 'party_parrot', url: '/a', animated: true },
	{ name: 'party_cat', url: '/b', animated: false },
];
vi.mock('./use-emoji', () => ({ useCustomEmoji: () => ({ items }) }));

import { useShortcodeAutocomplete } from './use-shortcode-autocomplete';

const key = (k: string, extra: object = {}) => ({ key: k, preventDefault: vi.fn(), ...extra });

describe('useShortcodeAutocomplete', () => {
	it('opens with matches once a shortcode is being typed and closes otherwise', () => {
		const { result } = renderHook(() => useShortcodeAutocomplete());
		expect(result.current.isOpen).toBe(false);
		act(() => result.current.track('hi :par', 7));
		expect(result.current.isOpen).toBe(true);
		expect(result.current.matches.map((m) => m.name)).toEqual(['party_cat', 'party_parrot'].filter((n) => n.startsWith('par') || n.includes('par')));
		act(() => result.current.track('hi', 2));
		expect(result.current.isOpen).toBe(false);
	});

	it('navigates, picks with Enter and ignores shift+Enter', () => {
		const { result } = renderHook(() => useShortcodeAutocomplete());
		act(() => result.current.track(':party', 6));
		const names = result.current.matches.map((m) => m.name);
		expect(names).toEqual(['party_cat', 'party_parrot']);

		let r: unknown;
		act(() => {
			r = result.current.handleKey(key('ArrowDown'));
		});
		expect(r).toBe('handled');
		expect(result.current.selectedIndex).toBe(1);
		act(() => {
			r = result.current.handleKey(key('Enter', { shiftKey: true }));
		});
		expect(r).toBeNull();
		act(() => {
			r = result.current.handleKey(key('Enter'));
		});
		expect(r).toEqual({ pick: items[0] });
	});

	it('Escape closes and key presses are ignored while closed', () => {
		const { result } = renderHook(() => useShortcodeAutocomplete());
		expect(result.current.handleKey(key('Enter'))).toBeNull();
		act(() => result.current.track(':party', 6));
		act(() => {
			result.current.handleKey(key('Escape'));
		});
		expect(result.current.isOpen).toBe(false);
	});

	it('pick returns the completed text', () => {
		const { result } = renderHook(() => useShortcodeAutocomplete());
		act(() => result.current.track(':party', 6));
		let out: { text: string; cursor: number } | undefined;
		act(() => {
			out = result.current.pick(':party', 6, 'party_cat');
		});
		expect(out).toEqual({ text: ':party_cat: ', cursor: 12 });
		expect(result.current.isOpen).toBe(false);
	});
});
