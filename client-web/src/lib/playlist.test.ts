import { describe, expect, it } from 'vitest';

import { neighbour } from './playlist';

const q = [{ fileId: 'a' }, { fileId: 'b' }, { fileId: 'c' }];

describe('neighbour', () => {
	it('returns the next and previous track', () => {
		expect(neighbour(q, 'b', 1)?.fileId).toBe('c');
		expect(neighbour(q, 'b', -1)?.fileId).toBe('a');
	});

	it('stops at both ends instead of wrapping', () => {
		expect(neighbour(q, 'c', 1)).toBeNull();
		expect(neighbour(q, 'a', -1)).toBeNull();
	});

	it('finds nothing when the current track is not in the queue', () => {
		expect(neighbour(q, 'zzz', 1)).toBeNull();
		expect(neighbour([], 'a', 1)).toBeNull();
	});
});
