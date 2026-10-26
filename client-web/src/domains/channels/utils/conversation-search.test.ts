import { describe, expect, it } from 'vitest';

import type { Channel, ExploreChannel } from '@/types/api';
import { buildSearchItems } from './conversation-search';

const ch = (over: Partial<Channel>): Channel =>
	({ id: 'x', name: 'x', members: ['a', 'b', 'c'], ...over }) as Channel;
const ex = (id: string, name: string): ExploreChannel =>
	({ id, name, invite_link: id, member_count: 1, created_at: '' }) as ExploreChannel;

const dm = ch({ id: 'dm', name: '', members: ['me', 'sara'] });
const design = ch({ id: 'g1', name: 'design', description: 'UI and branding' });
const random = ch({ id: 'g2', name: 'random' });
const names: Record<string, string> = { dm: 'Sara', g1: 'design', g2: 'random' };
const displayName = (c: Channel) => names[c.id];
const channels = [dm, design, random];
const explore = [ex('g1', 'design'), ex('p1', 'public-news')];

const run = (filter: Parameters<typeof buildSearchItems>[0]['filter'], query = '') =>
	buildSearchItems({ channels, exploreChannels: explore, filter, query, displayName });

describe('buildSearchItems', () => {
	it('lists DMs first, then channels, with no public results until the user types', () => {
		const { items } = run('all');
		expect(items.map((i) => `${i.type}:${i.channel.id}`)).toEqual(['channel:dm', 'channel:g1', 'channel:g2']);
	});

	it('adds public channels (minus joined ones) once a query is typed', () => {
		const { items, publicChannels } = run('all', 'p');
		expect(publicChannels.map((c) => c.id)).toEqual(['p1']);
		expect(items.at(-1)).toMatchObject({ type: 'explore' });
	});

	it('matches the display name or the description, case-insensitively', () => {
		expect(run('all', 'SARA').dms.map((c) => c.id)).toEqual(['dm']);
		expect(run('all', 'branding').groupChannels.map((c) => c.id)).toEqual(['g1']);
	});

	it('respects the tab filters', () => {
		expect(run('dms').items.map((i) => i.channel.id)).toEqual(['dm']);
		expect(run('channels').items.map((i) => i.channel.id)).toEqual(['g1', 'g2']);
		expect(run('dms').publicChannels).toEqual([]);
	});

	it('shows only public channels on the explore tab', () => {
		const { items } = run('explore');
		expect(items.every((i) => i.type === 'explore')).toBe(true);
		expect(items.map((i) => i.channel.id)).toEqual(['p1']);
	});
});
