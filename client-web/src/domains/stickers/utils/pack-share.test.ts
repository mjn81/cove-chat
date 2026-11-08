import { describe, it, expect } from 'vitest';
import { encodePackShare, parsePackShare } from './pack-share';

describe('pack share token', () => {
	it('round-trips a pack id', () => {
		expect(parsePackShare(encodePackShare('3f2a9c-ab_12'))).toBe('3f2a9c-ab_12');
	});
	it('ignores surrounding whitespace', () => {
		expect(parsePackShare('  cove://stickers/abc123 \n')).toBe('abc123');
	});
	it('only matches when the token is the whole message', () => {
		expect(parsePackShare('look cove://stickers/abc123')).toBeNull();
		expect(parsePackShare('cove://stickers/abc123 and more')).toBeNull();
	});
	it('rejects missing, empty or malformed ids', () => {
		expect(parsePackShare(undefined)).toBeNull();
		expect(parsePackShare('cove://stickers/')).toBeNull();
		expect(parsePackShare('cove://stickers/a/b')).toBeNull();
		expect(parsePackShare(`cove://stickers/${'x'.repeat(129)}`)).toBeNull();
		expect(parsePackShare('https://stickers/abc')).toBeNull();
	});
});
