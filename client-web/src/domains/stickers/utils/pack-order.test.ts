import { describe, it, expect } from 'vitest';
import { moveItem } from './pack-order';

describe('moveItem', () => {
	it('moves forward and backward', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
		expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
	});
	it('does not mutate and ignores bad indexes', () => {
		const src = ['a', 'b'];
		expect(moveItem(src, 0, 5)).toEqual(['a', 'b']);
		expect(moveItem(src, -1, 0)).toEqual(['a', 'b']);
		expect(moveItem(src, 1, 1)).toEqual(['a', 'b']);
		expect(src).toEqual(['a', 'b']);
	});
});
