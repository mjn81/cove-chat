import { describe, it, expect } from 'vitest';
import { findShortcodeQuery, applyShortcode, filterCustomEmoji } from './shortcode-autocomplete';

const item = (name: string) => ({ name, url: `/x/${name}`, animated: false });

describe('findShortcodeQuery', () => {
	it('finds a query at the caret', () => {
		expect(findShortcodeQuery('hello :par', 10)).toEqual({ start: 6, query: 'par' });
		expect(findShortcodeQuery(':pa', 3)).toEqual({ start: 0, query: 'pa' });
	});
	it('needs two characters, a word boundary and no closing colon', () => {
		expect(findShortcodeQuery(':p', 2)).toBeNull();
		expect(findShortcodeQuery('10:30', 5)).toBeNull();
		expect(findShortcodeQuery(':party:', 7)).toBeNull();
		expect(findShortcodeQuery('hi', 2)).toBeNull();
	});
	it('only looks before the caret', () => {
		expect(findShortcodeQuery(':party rest', 3)).toEqual({ start: 0, query: 'pa' });
		expect(findShortcodeQuery(':party rest', 8)).toBeNull();
		expect(findShortcodeQuery(':party rest', 6)).toEqual({ start: 0, query: 'party' });
	});
});

describe('applyShortcode', () => {
	it('swaps the query for the finished shortcode and a space', () => {
		expect(applyShortcode('hello :par', 10, 'party_parrot')).toEqual({
			text: 'hello :party_parrot: ',
			cursor: 21,
		});
	});
	it('keeps text after the caret', () => {
		expect(applyShortcode(':pa tail', 3, 'pa_x')).toEqual({ text: ':pa_x:  tail', cursor: 7 });
	});
	it('does nothing when there is no query', () => {
		expect(applyShortcode('hello', 5, 'x_y')).toEqual({ text: 'hello', cursor: 5 });
	});
});

describe('filterCustomEmoji', () => {
	const items = [item('super_party'), item('party_parrot'), item('party'), item('cat')];
	it('ranks prefix matches before contains matches', () => {
		expect(filterCustomEmoji(items, 'party').map((i) => i.name)).toEqual(['party', 'party_parrot', 'super_party']);
	});
	it('respects the limit', () => {
		expect(filterCustomEmoji(items, 'pa', 2)).toHaveLength(2);
	});
});
