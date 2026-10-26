import type { Channel } from '@/types/api';
import { isDirectMessage } from '@/utils/channel';

/** Sidebar tab filter: everything, direct messages only, or channels only. */
export type ChannelListTab = 'all' | 'dms' | 'channels';

/**
 * Sort comparator: newest activity first, falling back to creation time for
 * conversations that have no messages yet. Timestamps are RFC3339 so string
 * comparison orders them correctly.
 */
export function compareByRecency(a: Channel, b: Channel): number {
	const ta = a.last_message_at || a.created_at || '';
	const tb = b.last_message_at || b.created_at || '';
	return tb.localeCompare(ta);
}

interface SelectVisibleChannelsArgs {
	channels: Channel[];
	tab: ChannelListTab;
	/** Raw search text; matched case-insensitively against the display name. */
	query: string;
	/** Resolves what the user sees as the conversation name (DMs show the peer). */
	displayName: (channel: Channel) => string;
}

/**
 * Filters the sidebar list by tab and search text and sorts it by recency.
 * Returns a new array; the input is never mutated.
 */
export function selectVisibleChannels({
	channels,
	tab,
	query,
	displayName,
}: SelectVisibleChannelsArgs): Channel[] {
	const needle = query.toLowerCase();
	return channels
		.filter((ch) => displayName(ch).toLowerCase().includes(needle))
		.filter((ch) => (tab === 'all' ? true : tab === 'dms' ? isDirectMessage(ch) : !isDirectMessage(ch)))
		.sort(compareByRecency);
}
