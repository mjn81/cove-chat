/**
 * Emoji text helpers: grapheme splitting, the sprite-index key rule and the tokenizer that the message renderer and
 * the big-emoji classifier share. Pure functions only; no DOM, no network.
 */

/** A piece of text after emoji and `:name:` detection. Tokens concatenate back to the original text. */
export type EmojiToken =
	| { type: 'text'; value: string }
	| { type: 'emoji'; value: string; key: string }
	| { type: 'custom'; value: string; name: string };

/** Server rule for custom emoji names (docs/packs-api.md): lower case letters, digits and `_`, 2 to 32 long. */
const CUSTOM_NAME = '[a-z0-9_]{2,32}';

/** Matches `:name:` with a capture for the name. */
export const CUSTOM_EMOJI_RE = new RegExp(`:(${CUSTOM_NAME}):`);

/** Emoji presentation, an explicit VS16, or a keycap: the signals that a grapheme is drawn as an emoji, not as text. */
const EMOJI_SIGNAL = /\p{Emoji_Presentation}|️|⃣/u;

type SegmenterCtor = new (
	locales?: string | string[],
	options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> };

/**
 * Splits text into user-perceived characters, so a skin tone, flag or ZWJ family stays one unit.
 * Falls back to code points on engines without `Intl.Segmenter` (still correct for plain emoji).
 *
 * @param text - Any string.
 */
export function splitGraphemes(text: string): string[] {
	const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
	if (Segmenter) {
		return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
	}
	return Array.from(text);
}

/**
 * The key used by the server's sprite index and animated table: lower-case hex code points joined by `-`,
 * with every U+FE0F removed (a red heart is `2764`, a thumbs up with skin tone is `1f44d-1f3fd`).
 *
 * @param emoji - A rendered emoji (one grapheme).
 */
export function emojiKey(emoji: string): string {
	const parts: string[] = [];
	for (const ch of emoji) {
		const cp = ch.codePointAt(0)!;
		if (cp !== 0xfe0f) parts.push(cp.toString(16));
	}
	return parts.join('-');
}

/**
 * Whether one grapheme is an emoji (as opposed to text such as digits, `#`, copyright signs or letters).
 *
 * @param grapheme - One user-perceived character.
 */
export function isEmojiGrapheme(grapheme: string): boolean {
	return grapheme !== '' && EMOJI_SIGNAL.test(grapheme);
}

/**
 * Splits message text into text, emoji and custom `:name:` tokens.
 *
 * @param text - Decrypted message body.
 * @param customNames - Names of the server's custom emoji; an unknown `:name:` stays text, exactly as typed.
 */
export function tokenizeEmojiText(text: string, customNames?: ReadonlySet<string>): EmojiToken[] {
	const tokens: EmojiToken[] = [];
	const pushText = (value: string) => {
		if (!value) return;
		const prev = tokens[tokens.length - 1];
		if (prev?.type === 'text') prev.value += value;
		else tokens.push({ type: 'text', value });
	};
	const pushPlain = (chunk: string) => {
		for (const g of splitGraphemes(chunk)) {
			if (isEmojiGrapheme(g)) tokens.push({ type: 'emoji', value: g, key: emojiKey(g) });
			else pushText(g);
		}
	};

	if (!customNames || customNames.size === 0) {
		pushPlain(text);
		return tokens;
	}
	const re = new RegExp(CUSTOM_EMOJI_RE.source, 'g');
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (!customNames.has(m[1])) {
			// Step back so the closing colon can open the next shortcode (":nope:aa:" still finds ":aa:").
			re.lastIndex = m.index + 1;
			continue;
		}
		pushPlain(text.slice(last, m.index));
		tokens.push({ type: 'custom', value: m[0], name: m[1] });
		last = m.index + m[0].length;
	}
	pushPlain(text.slice(last));
	return tokens;
}
