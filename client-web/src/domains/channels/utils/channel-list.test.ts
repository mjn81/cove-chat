import { describe, expect, it } from 'vitest';

import type { Channel } from '@/types/api';
import { compareByRecency, selectVisibleChannels } from './channel-list';

const make = (over: Partial<Channel>): Channel =>
	({
		id: 'c',
		name: 'general',
		members: ['a', 'b', 'c'],
		created_at: '2026-01-01T00:00:00Z',
		...over,
	}) as Channel;

const dm = make({ id: 'dm', name: '', members: ['me', 'sara'], last_message_at: '2026-03-01T00:00:00Z' });
const general = make({ id: 'g', name: 'general', last_message_at: '2026-02-01T00:00:00Z' });
const design = make({ id: 'd', name: 'design', last_message_at: undefined, created_at: '2026-04-01T00:00:00Z' });
const names: Record<string, string> = { dm: 'Sara', g: 'general', d: 'design' };
const displayName = (c: Channel) => names[c.id];

describe('compareByRecency', () => {
	it('puts the most recently active conversation first, falling back to creation time', () => {
		const sorted = [general, dm, design].sort(compareByRecency).map((c) => c.id);
		expect(sorted).toEqual(['d', 'dm', 'g']);
	});
});

describe('selectVisibleChannels', () => {
	const all = [general, dm, design];

	it('shows everything on the "all" tab, newest first', () => {
		const ids = selectVisibleChannels({ channels: all, tab: 'all', query: '', displayName }).map((c) => c.id);
		expect(ids).toEqual(['d', 'dm', 'g']);
	});

	it('splits direct messages from channels by tab', () => {
		expect(
			selectVisibleChannels({ channels: all, tab: 'dms', query: '', displayName }).map((c) => c.id),
		).toEqual(['dm']);
		expect(
			selectVisibleChannels({ channels: all, tab: 'channels', query: '', displayName }).map((c) => c.id),
		).toEqual(['d', 'g']);
	});

	it('filters by display name, case-insensitively', () => {
		expect(
			selectVisibleChannels({ channels: all, tab: 'all', query: 'SAR', displayName }).map((c) => c.id),
		).toEqual(['dm']);
	});

	it('does not mutate the input array', () => {
		const input = [general, dm, design];
		selectVisibleChannels({ channels: input, tab: 'all', query: '', displayName });
		expect(input.map((c) => c.id)).toEqual(['g', 'dm', 'd']);
	});
});
