import { describe, it, expect } from 'vitest';
import { emojiKey, firstEmoji, isEmojiGrapheme, isValidEmojiName, normalizeEmojiName, splitGraphemes, tokenizeEmojiText, CUSTOM_EMOJI_RE } from './emoji-text';

describe('emojiKey', () => {
	it('hex-encodes code points and drops every FE0F', () => {
		expect(emojiKey('😀')).toBe('1f600');
		expect(emojiKey('❤️')).toBe('2764');
		expect(emojiKey('👍🏽')).toBe('1f44d-1f3fd');
		expect(emojiKey('🇩🇪')).toBe('1f1e9-1f1ea');
		expect(emojiKey('👨‍👩‍👧')).toBe('1f468-200d-1f469-200d-1f467');
		expect(emojiKey('❤️‍🔥')).toBe('2764-200d-1f525');
	});
});

describe('isEmojiGrapheme', () => {
	it('accepts emoji, flags, keycaps and ZWJ sequences', () => {
		for (const e of ['😀', '❤️', '👍🏽', '🇩🇪', '1️⃣', '👨‍👩‍👧']) expect(isEmojiGrapheme(e), e).toBe(true);
	});
	it('rejects plain text, digits and text-presentation symbols', () => {
		for (const e of ['a', '1', '#', '©', 'م', ' ', '']) expect(isEmojiGrapheme(e), e).toBe(false);
	});
});

describe('splitGraphemes', () => {
	it('keeps skin tones, flags and ZWJ sequences as one unit', () => {
		expect(splitGraphemes('a👍🏽🇩🇪👨‍👩‍👧b')).toEqual(['a', '👍🏽', '🇩🇪', '👨‍👩‍👧', 'b']);
	});
});

describe('tokenizeEmojiText', () => {
	it('splits text and emoji and concatenates back to the input', () => {
		const text = 'hi 😀 there 👍🏽!';
		const tokens = tokenizeEmojiText(text);
		expect(tokens.map((t) => t.value).join('')).toBe(text);
		expect(tokens.filter((t) => t.type === 'emoji').map((t) => t.value)).toEqual(['😀', '👍🏽']);
		expect(tokens[1]).toEqual({ type: 'emoji', value: '😀', key: '1f600' });
	});

	it('returns a single text token for plain text', () => {
		expect(tokenizeEmojiText('hello')).toEqual([{ type: 'text', value: 'hello' }]);
		expect(tokenizeEmojiText('')).toEqual([]);
	});

	it('resolves only known :name: shortcodes', () => {
		const known = new Set(['party_parrot']);
		const tokens = tokenizeEmojiText('a :party_parrot: b :nope: c', known);
		expect(tokens).toEqual([
			{ type: 'text', value: 'a ' },
			{ type: 'custom', value: ':party_parrot:', name: 'party_parrot' },
			{ type: 'text', value: ' b :nope: c' },
		]);
	});

	it('does not treat times like 10:30:45 as shortcodes unless the name exists', () => {
		expect(tokenizeEmojiText('10:30:45', new Set(['party_parrot']))).toEqual([{ type: 'text', value: '10:30:45' }]);
	});

	it('finds a shortcode right after an unknown one', () => {
		const known = new Set(['aa']);
		const types = tokenizeEmojiText(':nope:aa:', known).map((t) => t.type);
		expect(types).toEqual(['text', 'custom']);
	});
});

describe('CUSTOM_EMOJI_RE', () => {
	it('matches the server shortcode rule', () => {
		expect(':ab:'.match(CUSTOM_EMOJI_RE)).not.toBeNull();
		expect(':a:'.match(CUSTOM_EMOJI_RE)).toBeNull();
		expect(':Ab:'.match(CUSTOM_EMOJI_RE)).toBeNull();
	});
});

describe('firstEmoji', () => {
	it('returns the first emoji grapheme or nothing', () => {
		expect(firstEmoji('ab 👍🏽😀')).toBe('👍🏽');
		expect(firstEmoji('no emoji')).toBe('');
		expect(firstEmoji('')).toBe('');
	});
});

describe('normalizeEmojiName / isValidEmojiName', () => {
	it('normalises like the server', () => {
		expect(normalizeEmojiName(':Party Parrot:')).toBe('party_parrot');
		expect(normalizeEmojiName('  cat-face ')).toBe('cat_face');
	});
	it('validates the shortcode rule', () => {
		expect(isValidEmojiName('party_parrot')).toBe(true);
		expect(isValidEmojiName('a')).toBe(false);
		expect(isValidEmojiName('x'.repeat(33))).toBe(false);
		expect(isValidEmojiName('bad name')).toBe(false);
		expect(isValidEmojiName('Upper')).toBe(false);
	});
});
