import { useCallback, useMemo, useState } from 'react';

import { apiJoinChannel } from '@/api/client';
import { useExploreChannels } from '@/hooks/useChannels';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuthStore, useChannelStore, getChannelDisplayName } from '@/store/store';
import { logger } from '@/utils/logger';
import { selectVisibleChannels, type ChannelListTab } from '../utils/channel-list';

/**
 * Data and actions behind the conversation sidebar: search text, the
 * filtered/sorted list for the active tab, public-channel discovery while
 * searching, and joining a public channel.
 *
 * @param tab - Active sidebar tab.
 */
export function useSidebarChannels(tab: ChannelListTab) {
	const userId = useAuthStore((s) => s.user?.id ?? '');
	const channels = useChannelStore((s) => s.channels);
	const isLoading = useChannelStore((s) => s.isChannelsLoading);

	const [search, setSearch] = useState('');
	const [isJoining, setIsJoining] = useState<string | null>(null);
	const debouncedSearch = useDebounce(search.trim(), 300);

	const { data: exploreChannels = [], isFetching: isExploring } = useExploreChannels(debouncedSearch);

	const visibleChannels = useMemo(
		() =>
			selectVisibleChannels({
				channels,
				tab,
				query: search,
				displayName: (ch) => getChannelDisplayName(ch, userId),
			}),
		[channels, tab, search, userId],
	);

	/** Public channels from the explore list that the user has not joined yet. */
	const joinableChannels = useMemo(
		() => exploreChannels.filter((ch) => !channels.some((c) => c.id === ch.id)),
		[exploreChannels, channels],
	);

	const joinChannel = useCallback(
		async (inviteLink: string, id: string) => {
			if (isJoining) return;
			try {
				setIsJoining(id);
				await apiJoinChannel(inviteLink);
				await useChannelStore.getState().refreshChannels();
				const joined = useChannelStore.getState().channels.find((c) => c.id === id);
				if (joined) useChannelStore.getState().setActiveChannel(joined);
				setSearch('');
			} catch (error) {
				logger.error('Failed to join channel', { error: String(error) });
			} finally {
				setIsJoining(null);
			}
		},
		[isJoining],
	);

	return {
		search,
		setSearch,
		isLoading,
		visibleChannels,
		joinableChannels,
		isExploring,
		isJoining,
		joinChannel,
	};
}
