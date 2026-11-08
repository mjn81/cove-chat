import { describe, it, expect } from 'vitest';
import { classifyEmojiMessage } from './classify-emoji-message';

const animated = new Set(['1f680', '2764', '1f44d-1f3fd', '1f468-200d-1f469-200d-1f467']);
const has = (k: string) => animated.has(k);

describe('classifyEmojiMessage', () => {
	it('single emoji with an animation is animated', () => {
		expect(classifyEmojiMessage('🚀', has)).toEqual({ kind: 'animated', key: '1f680', emoji: ['🚀'] });
	});

	it('ignores surrounding whitespace and newlines', () => {
		expect(classifyEmojiMessage('  \n🚀 \t', has).kind).toBe('animated');
	});

	it('treats variation selectors, skin tones and ZWJ sequences as one emoji', () => {
		expect(classifyEmojiMessage('❤️', has)).toMatchObject({ kind: 'animated', key: '2764' });
		expect(classifyEmojiMessage('👍🏽', has)).toMatchObject({ kind: 'animated', key: '1f44d-1f3fd' });
		expect(classifyEmojiMessage('👨‍👩‍👧', has)).toMatchObject({ kind: 'animated' });
	});

	it('single emoji without an animation is jumbo', () => {
		expect(classifyEmojiMessage('😀', has)).toEqual({ kind: 'jumbo', emoji: ['😀'] });
		expect(classifyEmojiMessage('🇩🇪', has).kind).toBe('jumbo');
	});

	it('two or three emoji are jumbo even when each has an animation', () => {
		expect(classifyEmojiMessage('🚀🚀', has)).toMatchObject({ kind: 'jumbo' });
		expect(classifyEmojiMessage('😀 😀 😀', has)).toMatchObject({ kind: 'jumbo', emoji: ['😀', '😀', '😀'] });
	});

	it('four or more emoji are normal', () => {
		expect(classifyEmojiMessage('😀😀😀😀', has).kind).toBe('normal');
	});

	it('any other text makes it normal', () => {
		expect(classifyEmojiMessage('hi 😀', has).kind).toBe('normal');
		expect(classifyEmojiMessage('😀!', has).kind).toBe('normal');
		expect(classifyEmojiMessage('', has).kind).toBe('normal');
		expect(classifyEmojiMessage('   ', has).kind).toBe('normal');
		expect(classifyEmojiMessage('1', has).kind).toBe('normal');
		expect(classifyEmojiMessage('@bob', has).kind).toBe('normal');
	});

	it('counts known custom emoji as jumbo members but never as animated', () => {
		const custom = new Set(['party_parrot']);
		expect(classifyEmojiMessage(':party_parrot:', has, custom)).toMatchObject({ kind: 'jumbo' });
		expect(classifyEmojiMessage(':nope:', has, custom).kind).toBe('normal');
		expect(classifyEmojiMessage(':party_parrot: 😀', has, custom).kind).toBe('jumbo');
	});

	it('works without an animated table', () => {
		expect(classifyEmojiMessage('🚀').kind).toBe('jumbo');
	});
});
