import { describe, expect, it } from 'vitest';

import { wrapIndex } from './collection';

describe('wrapIndex', () => {
	it('wraps past both ends', () => {
		expect(wrapIndex(0, -1, 3)).toBe(2);
		expect(wrapIndex(2, 1, 3)).toBe(0);
	});

	it('moves normally in the middle', () => {
		expect(wrapIndex(1, 1, 3)).toBe(2);
		expect(wrapIndex(1, -1, 3)).toBe(0);
	});

	it('stays at 0 for an empty or single-item list', () => {
		expect(wrapIndex(0, 1, 0)).toBe(0);
		expect(wrapIndex(0, 1, 1)).toBe(0);
	});
});
