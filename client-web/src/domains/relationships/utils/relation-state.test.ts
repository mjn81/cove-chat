import { describe, expect, it } from 'vitest';

import type { RelationshipResponse, RelationshipType } from '@/types/api';
import { getRelationState } from './relation-state';

const outgoing = (to: string, type: RelationshipType): RelationshipResponse => ({
	from_user_id: 'me',
	to_user_id: to,
	type,
});
const incoming = (from: string): RelationshipResponse => ({
	from_user_id: from,
	to_user_id: 'me',
	type: 'requested',
});

describe('getRelationState', () => {
	it('is "none" for strangers', () => {
		expect(getRelationState('u1', [], [])).toBe('none');
		expect(getRelationState('u1', [outgoing('u2', 'friend')], [incoming('u3')])).toBe('none');
	});

	it('reports my outgoing relationship', () => {
		expect(getRelationState('u1', [outgoing('u1', 'friend')], [])).toBe('friend');
		expect(getRelationState('u1', [outgoing('u1', 'requested')], [])).toBe('requested');
		expect(getRelationState('u1', [outgoing('u1', 'blocked')], [])).toBe('blocked');
	});

	it('reports a request that is waiting for me to answer', () => {
		expect(getRelationState('u1', [], [incoming('u1')])).toBe('incoming');
	});

	it('lets a block win over their pending request to me', () => {
		expect(getRelationState('u1', [outgoing('u1', 'blocked')], [incoming('u1')])).toBe('blocked');
	});
});
