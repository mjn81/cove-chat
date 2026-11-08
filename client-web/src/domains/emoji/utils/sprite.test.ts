import { describe, it, expect } from 'vitest';
import { spriteStyle, styleCacheKey } from './sprite';

const index = { size: 64, width: 640, height: 320, emoji: { '1f600': [128, 64] as [number, number] } };

describe('spriteStyle', () => {
	it('scales the sheet and offsets to the cell', () => {
		const s = spriteStyle('blob:x', index, '1f600', 32);
		expect(s).toMatchObject({
			backgroundSize: '320px 160px',
			backgroundPosition: '-64px -32px',
		});
		expect(s?.backgroundImage).toBe('url("blob:x")');
	});
	it('returns null for an emoji the style lacks', () => {
		expect(spriteStyle('blob:x', index, '1f9ff', 32)).toBeNull();
	});
});

describe('styleCacheKey', () => {
	it('includes the version', () => {
		expect(styleCacheKey('noto', 'abc', 'sheet')).toBe('emoji:noto:abc:sheet');
		expect(styleCacheKey('noto', 'abd', 'sheet')).not.toBe(styleCacheKey('noto', 'abc', 'sheet'));
	});
});
