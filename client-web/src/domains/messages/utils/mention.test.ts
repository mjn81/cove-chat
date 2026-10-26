import { describe, expect, it } from 'vitest';

import { applyMention, detectMention, filterMentionMembers } from './mention';

describe('detectMention', () => {
	it('returns the text typed after an @ at the start of the message', () => {
		expect(detectMention('@sa', 3)).toBe('sa');
		expect(detectMention('@', 1)).toBe('');
	});

	it('triggers after a space but not inside a word (e-mail addresses)', () => {
		expect(detectMention('hi @om', 6)).toBe('om');
		expect(detectMention('mail me at a@b', 14)).toBeNull();
	});

	it('stops once the mention is followed by a space', () => {
		expect(detectMention('@sara hello', 11)).toBeNull();
	});

	it('only looks at text before the cursor', () => {
		expect(detectMention('hi @omid', 5)).toBe('o');
	});

	it('returns null when there is no @', () => {
		expect(detectMention('hello', 5)).toBeNull();
	});
});

describe('applyMention', () => {
	it('replaces the partial mention and places the cursor after the trailing space', () => {
		expect(applyMention('hi @om', 6, 'omid')).toEqual({ text: 'hi @omid ', cursor: 9 });
	});

	it('keeps the text after the cursor', () => {
		expect(applyMention('@sa there', 3, 'sara')).toEqual({ text: '@sara  there', cursor: 6 });
	});
});

describe('filterMentionMembers', () => {
	const members = [
		{ id: 'me', username: 'mjn' },
		{ id: 'a', username: 'Sara' },
		{ id: 'b', username: 'Omid' },
	];

	it('excludes the current user and matches case-insensitively', () => {
		expect(filterMentionMembers(members, 'me', 'sa').map((m) => m.id)).toEqual(['a']);
		expect(filterMentionMembers(members, 'me', '').map((m) => m.id)).toEqual(['a', 'b']);
	});

	it('treats a null query as "show everyone"', () => {
		expect(filterMentionMembers(members, 'me', null)).toHaveLength(2);
	});
});
