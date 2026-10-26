import type { Channel, ExploreChannel } from '@/types/api';
import { isDirectMessage } from '@/utils/channel';

/** Tabs of the global conversation search (Ctrl/Cmd+K). */
export type SearchFilter = 'all' | 'dms' | 'channels' | 'explore';

/** A selectable row: one of the user's conversations, or a public channel they could join. */
export type SearchItem =
	| { type: 'channel'; channel: Channel }
	| { type: 'explore'; channel: ExploreChannel };

interface BuildArgs {
	channels: Channel[];
	/** Public channels returned by the server for the current query. */
	exploreChannels: ExploreChannel[];
	filter: SearchFilter;
	/** Raw search text. */
	query: string;
	/** What the user sees as the conversation name (DMs show the peer). */
	displayName: (channel: Channel) => string;
}

/** Result of {@link buildSearchItems}. */
export interface SearchSections {
	dms: Channel[];
	groupChannels: Channel[];
	/** Public channels the user has not joined yet. */
	publicChannels: ExploreChannel[];
	/** All rows in the order they are displayed, for arrow-key navigation. */
	items: SearchItem[];
}

/**
 * Splits the search results into DMs, joined channels and joinable public
 * channels according to the active tab and query, and flattens them into the
 * display order used for keyboard navigation.
 *
 * Joined conversations match by display name or description; public channels
 * only appear on the Explore tab, or on "All" once something has been typed.
 */
export function buildSearchItems({
	channels,
	exploreChannels,
	filter,
	query,
	displayName,
}: BuildArgs): SearchSections {
	const q = query.toLowerCase().trim();

	const matching = channels.filter((ch) => {
		const isDM = isDirectMessage(ch);
		if (filter === 'dms' && !isDM) return false;
		if (filter === 'channels' && isDM) return false;
		if (!q) return true;
		return (
			displayName(ch).toLowerCase().includes(q) || Boolean(ch.description?.toLowerCase().includes(q))
		);
	});
	const dms = matching.filter(isDirectMessage);
	const groupChannels = matching.filter((ch) => !isDirectMessage(ch));

	const joined = new Set(channels.map((c) => c.id));
	const publicChannels =
		filter === 'dms' ? [] : exploreChannels.filter((ch) => !joined.has(ch.id));

	const asChannels = (list: Channel[]): SearchItem[] => list.map((channel) => ({ type: 'channel', channel }));
	const asExplore = (list: ExploreChannel[]): SearchItem[] => list.map((channel) => ({ type: 'explore', channel }));

	let items: SearchItem[];
	if (filter === 'explore') items = asExplore(publicChannels);
	else if (filter === 'dms') items = asChannels(dms);
	else if (filter === 'channels') items = asChannels(groupChannels);
	else items = [...asChannels(dms), ...asChannels(groupChannels), ...(q ? asExplore(publicChannels) : [])];

	return { dms, groupChannels, publicChannels, items };
}
