import { useCallback, useMemo, useState } from 'react';

import type { CustomEmojiItem } from '../types/emoji.types';
import { applyShortcode, filterCustomEmoji, findShortcodeQuery } from '../utils/shortcode-autocomplete';
import { useCustomEmoji } from './use-emoji';

/** What a key press did to the popup. */
export type ShortcodeKeyResult = 'handled' | { pick: CustomEmojiItem } | null;

/**
 * `:name` autocomplete for the composer: tracks the shortcode being typed, offers matching custom emoji and handles
 * the navigation keys, mirroring `useMentions`. Does nothing on servers without custom emoji (the list is empty).
 */
export function useShortcodeAutocomplete() {
	const { items } = useCustomEmoji();
	const [query, setQuery] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);

	const matches = useMemo(() => (query === null ? [] : filterCustomEmoji(items, query)), [items, query]);
	const isOpen = query !== null && matches.length > 0;

	/** Call on every text or caret change. */
	const track = useCallback((text: string, cursor: number) => {
		const found = findShortcodeQuery(text, cursor);
		setQuery(found ? found.query : null);
		setSelectedIndex(0);
	}, []);

	const close = useCallback(() => setQuery(null), []);

	/**
	 * Handles ArrowUp/Down, Enter/Tab (pick) and Escape while the popup is open.
	 *
	 * @returns `'handled'` when the key was consumed, `{pick}` when an emoji was chosen, null when ignored.
	 */
	const handleKey = useCallback(
		(e: { key: string; shiftKey?: boolean; preventDefault: () => void }): ShortcodeKeyResult => {
			if (!isOpen) return null;
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedIndex((i) => (i + 1) % matches.length);
				return 'handled';
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedIndex((i) => (i - 1 + matches.length) % matches.length);
				return 'handled';
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				if (e.key === 'Enter' && e.shiftKey) return null;
				e.preventDefault();
				return { pick: matches[selectedIndex] ?? matches[0] };
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				close();
				return 'handled';
			}
			return null;
		},
		[isOpen, matches, selectedIndex, close],
	);

	/** Replaces the typed `:query` with the chosen shortcode. */
	const pick = useCallback(
		(text: string, cursor: number, name: string) => {
			close();
			return applyShortcode(text, cursor, name);
		},
		[close],
	);

	return { isOpen, query, matches, selectedIndex, setSelectedIndex, track, handleKey, pick, close };
}
