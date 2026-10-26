import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiGetChannelMembers } from '@/api/client';
import { useAuthStore } from '@/store/store';
import { logger } from '@/utils/logger';
import { applyMention, detectMention, filterMentionMembers, type MentionMember } from '../utils/mention';

/**
 * @-mention picker state for the composer: loads the channel's members,
 * tracks the partial mention under the caret, and handles the picker's
 * keyboard navigation. The composer keeps ownership of the text itself.
 *
 * @param channelId - Channel whose members can be mentioned.
 * @param inputRef - Textarea, used to close the picker when clicking elsewhere.
 */
export function useMentions(channelId: string, inputRef: React.RefObject<HTMLTextAreaElement | null>) {
	const userId = useAuthStore((s) => s.user?.id);
	const [members, setMembers] = useState<MentionMember[]>([]);
	const [query, setQuery] = useState<string | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);

	useEffect(() => {
		if (!channelId) return;
		apiGetChannelMembers(channelId)
			.then(setMembers)
			.catch((err) => logger.error('Failed to load channel members', { error: String(err) }));
	}, [channelId]);

	// Click outside the textarea closes the picker.
	useEffect(() => {
		if (!isOpen) return;
		const onMouseDown = (e: MouseEvent) => {
			if (!inputRef.current?.contains(e.target as Node)) setIsOpen(false);
		};
		window.addEventListener('mousedown', onMouseDown);
		return () => window.removeEventListener('mousedown', onMouseDown);
	}, [isOpen, inputRef]);

	const filtered = useMemo(
		() => filterMentionMembers(members, userId, query),
		[members, userId, query],
	);

	const close = useCallback(() => {
		setIsOpen(false);
		setQuery(null);
	}, []);

	/** Call on every text change with the new value and caret position. */
	const track = useCallback((value: string, cursor: number) => {
		const q = detectMention(value, cursor);
		if (q === null) {
			setIsOpen(false);
			setQuery(null);
			return;
		}
		setQuery(q);
		setIsOpen(true);
		setSelectedIndex(0);
	}, []);

	/**
	 * Applies a picked member to `text` and closes the picker.
	 *
	 * @returns The new text and caret position for the composer to apply.
	 */
	const pick = useCallback(
		(text: string, cursor: number, username: string) => {
			close();
			return applyMention(text, cursor, username);
		},
		[close],
	);

	/**
	 * Handles ArrowUp/Down, Enter/Tab and Escape while the picker is open.
	 *
	 * @returns `'handled'` if the key was consumed, `'pick'` with the member to
	 * insert on Enter/Tab, or `null` to let the composer process the key.
	 */
	const handleKey = useCallback(
		(e: React.KeyboardEvent): { pick: MentionMember } | 'handled' | null => {
			if (!isOpen) return null;
			if (e.key === 'ArrowDown' && filtered.length > 0) {
				e.preventDefault();
				setSelectedIndex((i) => (i + 1) % filtered.length);
				return 'handled';
			}
			if (e.key === 'ArrowUp' && filtered.length > 0) {
				e.preventDefault();
				setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
				return 'handled';
			}
			if ((e.key === 'Enter' || e.key === 'Tab') && filtered[selectedIndex]) {
				e.preventDefault();
				return { pick: filtered[selectedIndex] };
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				setIsOpen(false);
				return 'handled';
			}
			return null;
		},
		[isOpen, filtered, selectedIndex],
	);

	return { isOpen, query, filtered, selectedIndex, setSelectedIndex, track, pick, close, handleKey };
}
