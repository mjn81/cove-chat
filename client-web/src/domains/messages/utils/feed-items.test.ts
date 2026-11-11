import { describe, expect, it } from 'vitest';
import type { Message } from '@/types/api';
import { formatDayLabel } from '@/utils/datetime';
import { buildFeedItems, type FeedItem } from './feed-items';

type Msg = Message & { text?: string };
const labels = { today: 'Today', yesterday: 'Yesterday' };

function msg(i: number, sentAt: Date, over: Partial<Msg> = {}): Msg {
	return {
		id: `m${i}`,
		channel_id: 'c',
		sender_id: i % 3 === 0 ? 'a' : 'b',
		type: 'text',
		ciphertext: '',
		nonce: '',
		compression: '',
		sent_at: sentAt.toISOString(),
		...over,
	};
}

/** The algorithm ChatMessageFeed used before extraction, kept as the behavioural reference. */
function reference(messages: Msg[], hasNextPage: boolean): FeedItem[] {
	const isGrouped = (prev: Msg | undefined, curr: Msg) =>
		!!prev &&
		!curr.reply_to_id &&
		prev.sender_id === curr.sender_id &&
		Math.abs(new Date(curr.sent_at).getTime() - new Date(prev.sent_at).getTime()) < 300_000;
	const items: FeedItem[] = [];
	messages.forEach((m, i) => {
		items.push({ type: 'msg', msg: m, grouped: isGrouped(messages[i + 1], m), id: m.id });
		const dateLabel = formatDayLabel(m.sent_at, labels);
		const next = messages[i + 1];
		const nextLabel = next ? formatDayLabel(next.sent_at, labels) : '';
		if (dateLabel !== nextLabel) items.push({ type: 'date', label: dateLabel, id: `date-${dateLabel}` });
	});
	if (!hasNextPage && items.length > 0) items.push({ type: 'header', id: 'welcome-header' });
	return items;
}

/** Newest first, bursts of messages with gaps, spanning several days, with replies sprinkled in. */
function history(count: number): Msg[] {
	const out: Msg[] = [];
	let t = Date.now();
	for (let i = 0; i < count; i++) {
		out.push(msg(i, new Date(t), i % 11 === 0 ? { reply_to_id: 'm1' } : {}));
		t -= (i % 7 === 0 ? 40 * 60_000 : 90_000) * (1 + (i % 5));
	}
	return out;
}

describe('buildFeedItems', () => {
	it('returns nothing for an empty list, without a welcome header', () => {
		expect(buildFeedItems([], false, labels)).toEqual([]);
	});

	it('matches the previous per-message algorithm exactly', () => {
		for (const hasNext of [true, false]) {
			const messages = history(400);
			expect(buildFeedItems(messages, hasNext, labels)).toEqual(reference(messages, hasNext));
		}
	});

	it('adds the welcome header only once the whole history is loaded', () => {
		const messages = history(3);
		expect(buildFeedItems(messages, false, labels).at(-1)).toEqual({ type: 'header', id: 'welcome-header' });
		expect(buildFeedItems(messages, true, labels).some((i) => i.type === 'header')).toBe(false);
	});

	it('never groups a reply and groups same-sender messages under five minutes', () => {
		const now = new Date();
		const older = msg(2, new Date(now.getTime() - 60_000), { sender_id: 'x' });
		const plain = msg(1, now, { sender_id: 'x' });
		const reply = msg(3, now, { sender_id: 'x', reply_to_id: 'q' });
		const find = (items: FeedItem[], id: string) => items.find((i) => i.type === 'msg' && i.id === id);
		expect(find(buildFeedItems([plain, older], true, labels), 'm1')).toMatchObject({ grouped: true });
		expect(find(buildFeedItems([reply, older], true, labels), 'm3')).toMatchObject({ grouped: false });
	});

	it('benchmark: day labels are formatted once per day, not twice per message', () => {
		const messages = history(2000);
		const time = (fn: () => void) => {
			fn();
			const start = performance.now();
			for (let i = 0; i < 5; i++) fn();
			return (performance.now() - start) / 5;
		};
		const before = time(() => reference(messages, true));
		const after = time(() => buildFeedItems(messages, true, labels));
		console.info(`feed items for 2000 messages: before ${before.toFixed(2)} ms, after ${after.toFixed(2)} ms`);
		expect(after).toBeLessThan(before);
	});
});
