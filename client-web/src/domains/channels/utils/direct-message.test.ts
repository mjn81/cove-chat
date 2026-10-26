import { describe, expect, it } from 'vitest';

import type { Channel } from '@/types/api';
import { findDirectChannel } from './direct-message';

const make = (id: string, name: string, members: string[]): Channel =>
	({ id, name, members }) as Channel;

describe('findDirectChannel', () => {
	const channels = [
		make('group', 'general', ['me', 'sara']),
		make('triple', '', ['me', 'sara', 'omid']),
		make('dm-sara', '', ['me', 'sara']),
		make('dm-omid', '', ['me', 'omid']),
	];

	it('finds the unnamed two-person channel with that user', () => {
		expect(findDirectChannel(channels, 'sara')?.id).toBe('dm-sara');
		expect(findDirectChannel(channels, 'omid')?.id).toBe('dm-omid');
	});

	it('ignores named channels and larger groups that merely contain the user', () => {
		expect(findDirectChannel([channels[0], channels[1]], 'sara')).toBeUndefined();
	});

	it('returns undefined when there is no DM yet', () => {
		expect(findDirectChannel(channels, 'nobody')).toBeUndefined();
	});
});
