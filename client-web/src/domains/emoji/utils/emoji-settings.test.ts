import { describe, it, expect } from 'vitest';
import { resolveEmojiStyle, resolveAnimated, pushRecent, sanitizeRecents } from './emoji-settings';

describe('resolveEmojiStyle', () => {
	const enabled = ['native', 'noto', 'twemoji'];
	it('uses the saved choice while the server offers it', () => {
		expect(resolveEmojiStyle('twemoji', enabled, 'noto')).toBe('twemoji');
	});
	it('falls back to the server default for a missing or disabled choice', () => {
		expect(resolveEmojiStyle(null, enabled, 'noto')).toBe('noto');
		expect(resolveEmojiStyle('fluent', enabled, 'noto')).toBe('noto');
	});
	it('falls back to the first enabled style when the default is not enabled', () => {
		expect(resolveEmojiStyle(null, ['twemoji'], 'noto')).toBe('twemoji');
	});
	it('is native without a server list (old server, capability missing)', () => {
		expect(resolveEmojiStyle('noto', undefined, undefined)).toBe('native');
		expect(resolveEmojiStyle('noto', [], 'noto')).toBe('native');
	});
});

describe('resolveAnimated', () => {
	it('follows reduced motion when automatic', () => {
		expect(resolveAnimated(null, false)).toBe(true);
		expect(resolveAnimated(null, true)).toBe(false);
	});
	it('lets an explicit choice win', () => {
		expect(resolveAnimated(true, true)).toBe(true);
		expect(resolveAnimated(false, false)).toBe(false);
	});
});

describe('pushRecent', () => {
	it('puts the newest first and removes duplicates', () => {
		expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
	});
	it('caps the list', () => {
		expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
	});
});

describe('sanitizeRecents', () => {
	it('keeps emoji and shortcodes, drops junk and duplicates', () => {
		expect(sanitizeRecents(['😀', '👍🏽', ':party_parrot:', 'abc', '😀😀', '', ' ', '😀', 5, null, ':x:'])).toEqual(['😀', '👍🏽', ':party_parrot:']);
	});
	it('survives non-arrays and caps the length', () => {
		expect(sanitizeRecents(undefined)).toEqual([]);
		expect(sanitizeRecents('x')).toEqual([]);
		expect(sanitizeRecents(Array.from({ length: 80 }, (_, i) => String.fromCodePoint(0x1f600 + (i % 60))))).toHaveLength(32);
	});
});
