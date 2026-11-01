import { useCallback, useMemo, useState } from 'react';

import { apiJoinChannel } from '@/api/client';
import { useExploreChannels } from '@/hooks/useChannels';
import { useUserSearch } from '@/hooks/useUsers';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuthStore, useChannelStore, getChannelDisplayName } from '@/store/store';
import { isDirectMessage } from '@/utils/channel';
import { wrapIndex } from '@/utils/collection';
import { logger } from '@/utils/logger';
import type { Channel, ExploreChannel, User } from '@/types/api';
import { buildSearchItems, type SearchFilter } from '../utils/conversation-search';

/**
 * State for the global conversation search: query, tab, keyboard selection,
 * public-channel discovery and joining. Mount it inside the dialog body so
 * everything resets each time the dialog opens.
 *
 * @param onDone - Closes the dialog after a conversation was opened or joined.
 */
export function useConversationSearch(onDone: () => void) {
	const userId = useAuthStore((s) => s.user?.id ?? '');
	const username = useAuthStore((s) => s.user?.username);
	const channels = useChannelStore((s) => s.channels);
	const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

	const [search, setSearchState] = useState('');
	const [filter, setFilterState] = useState<SearchFilter>('all');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [joiningId, setJoiningId] = useState<string | null>(null);
	const [startingDmId, setStartingDmId] = useState<string | null>(null);

	const debounced = useDebounce(search.trim(), 300);
	const { data: exploreChannels = [], isFetching: isExploring } = useExploreChannels(debounced);
	const { data: users = [], isFetching: isSearchingUsers } = useUserSearch(debounced, username);

	const sections = useMemo(
		() =>
			buildSearchItems({
				channels,
				exploreChannels,
				users,
				currentUserId: userId,
				filter,
				query: search,
				displayName: (ch) => getChannelDisplayName(ch, userId),
			}),
		[channels, exploreChannels, users, filter, search, userId],
	);

	/** Totals shown on the tabs (independent of the query). */
	const counts = useMemo(() => {
		const dmCount = channels.filter(isDirectMessage).length;
		return { all: channels.length, dms: dmCount, channels: channels.length - dmCount };
	}, [channels]);

	// Changing the query or tab restarts keyboard selection from the top.
	const setSearch = useCallback((value: string) => {
		setSearchState(value);
		setSelectedIndex(0);
	}, []);
	const setFilter = useCallback((value: SearchFilter) => {
		setFilterState(value);
		setSelectedIndex(0);
	}, []);

	const openChannel = useCallback(
		(ch: Channel) => {
			setActiveChannel(ch);
			onDone();
		},
		[setActiveChannel, onDone],
	);

	/** Starts (or reopens) the DM with someone found by name; the backend returns the existing DM when there is one. */
	const startDm = useCallback(
		async (target: User) => {
			if (startingDmId) return;
			try {
				setStartingDmId(target.id);
				const ch = await useChannelStore.getState().createChannel('', [userId, target.id], true);
				setActiveChannel(ch);
				onDone();
			} catch (err) {
				logger.error('Failed to start DM', { error: String(err) });
			} finally {
				setStartingDmId(null);
			}
		},
		[startingDmId, userId, setActiveChannel, onDone],
	);

	const joinChannel = useCallback(
		async (ch: ExploreChannel) => {
			if (joiningId) return;
			try {
				setJoiningId(ch.id);
				await apiJoinChannel(ch.invite_link || ch.id);
				await useChannelStore.getState().refreshChannels();
				const joined = useChannelStore.getState().channels.find((c) => c.id === ch.id);
				if (joined) useChannelStore.getState().setActiveChannel(joined);
				onDone();
			} catch (err) {
				logger.error('Failed to join channel', { error: String(err) });
			} finally {
				setJoiningId(null);
			}
		},
		[joiningId, onDone],
	);

	/** Arrow keys move the selection, Enter opens/joins the highlighted row. */
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const count = sections.items.length;
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedIndex((i) => wrapIndex(i, 1, count));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedIndex((i) => wrapIndex(i, -1, count));
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const current = sections.items[selectedIndex];
				if (!current) return;
				if (current.type === 'channel') openChannel(current.channel);
				else if (current.type === 'user') startDm(current.user);
				else joinChannel(current.channel);
			}
		},
		[sections.items, selectedIndex, openChannel, joinChannel, startDm],
	);

	return {
		search,
		setSearch,
		filter,
		setFilter,
		selectedIndex,
		setSelectedIndex,
		sections,
		counts,
		isExploring,
		isSearchingUsers,
		joiningId,
		startingDmId,
		openChannel,
		joinChannel,
		startDm,
		handleKeyDown,
	};
}
