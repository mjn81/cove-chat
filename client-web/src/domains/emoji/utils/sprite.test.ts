import { describe, it, expect } from 'vitest';
import { chooseFallbackStyle, pickSprite, spriteStyle, styleCacheKey } from './sprite';

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

describe('pickSprite', () => {
	const a = { sheetUrl: 'blob:a', index: { size: 64, width: 128, height: 128, emoji: { '1f600': [0, 0] as [number, number] } } };
	const b = { sheetUrl: 'blob:b', index: { size: 64, width: 128, height: 128, emoji: { '1f600': [64, 0] as [number, number], '1f1e9-1f1ea': [0, 64] as [number, number] } } };
	it('prefers the active style', () => {
		expect(pickSprite(a, b, '1f600', 32)?.backgroundImage).toBe('url("blob:a")');
	});
	it('falls back to the second style for gaps', () => {
		expect(pickSprite(a, b, '1f1e9-1f1ea', 32)?.backgroundImage).toBe('url("blob:b")');
	});
	it('works while a style is still loading and is null when nothing has the emoji', () => {
		expect(pickSprite(null, b, '1f600', 32)?.backgroundImage).toBe('url("blob:b")');
		expect(pickSprite(a, null, '1f1e9-1f1ea', 32)).toBeNull();
		expect(pickSprite(null, null, '1f600', 32)).toBeNull();
	});
});

describe('chooseFallbackStyle', () => {
	const counts = { noto: 3750, twemoji: 4009, blobmoji: 2687 };
	it('picks the fullest other style', () => {
		expect(chooseFallbackStyle(['native', 'noto', 'twemoji'], 'noto', counts)).toBe('twemoji');
		expect(chooseFallbackStyle(['noto', 'blobmoji'], 'noto', counts)).toBe('blobmoji');
	});
	it('is null when nothing else is offered', () => {
		expect(chooseFallbackStyle(['native', 'noto'], 'noto', counts)).toBeNull();
		expect(chooseFallbackStyle(['noto', 'twemoji'], 'native', {})).toBeNull();
	});
});
