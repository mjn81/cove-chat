import type { Message } from '@/types/api';
import { formatDayLabel, type DayLabels } from '@/utils/datetime';

type FeedMessage = Message & { text?: string };

/** One row of the message feed (newest first): a message, a day divider, or the start-of-history header. */
export type FeedItem =
	| { type: 'date'; label: string; id: string }
	| { type: 'header'; id: string }
	| { type: 'msg'; msg: FeedMessage; grouped: boolean; id: string };

/** Messages from one sender closer together than this share a header. */
const GROUP_WINDOW_MS = 300_000;

/**
 * Turns a newest-first message list into the feed's rows: each message (flagged when it continues the previous
 * sender's block), a day divider where the day changes, and the welcome header once no older history is left.
 *
 * Timestamps are parsed once per message and the day heading is formatted once per calendar day. Formatting it for
 * every message (twice, to compare with the neighbour) made `toLocaleDateString` the dominant cost of rebuilding a
 * long feed on every incoming message.
 *
 * @param messages - Newest first; index `i + 1` is the next older message.
 * @param hasNextPage - Whether older history can still be loaded.
 * @param labels - Translated "today" / "yesterday".
 */
export function buildFeedItems(messages: FeedMessage[], hasNextPage: boolean, labels: DayLabels): FeedItem[] {
	const labelByDay = new Map<string, string>();
	const times = new Array<number>(messages.length);
	const dayLabels = new Array<string>(messages.length);
	for (let i = 0; i < messages.length; i++) {
		const d = new Date(messages[i].sent_at);
		times[i] = d.getTime();
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		let label = labelByDay.get(key);
		if (label === undefined) {
			label = formatDayLabel(d, labels);
			labelByDay.set(key, label);
		}
		dayLabels[i] = label;
	}

	const items: FeedItem[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const older = messages[i + 1];
		const grouped =
			!!older &&
			!msg.reply_to_id &&
			older.sender_id === msg.sender_id &&
			Math.abs(times[i] - times[i + 1]) < GROUP_WINDOW_MS;
		items.push({ type: 'msg', msg, grouped, id: msg.id });
		const olderLabel = older ? dayLabels[i + 1] : '';
		if (dayLabels[i] !== olderLabel) items.push({ type: 'date', label: dayLabels[i], id: `date-${dayLabels[i]}` });
	}
	if (!hasNextPage && items.length > 0) items.push({ type: 'header', id: 'welcome-header' });
	return items;
}
