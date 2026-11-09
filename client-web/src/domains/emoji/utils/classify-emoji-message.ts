import { tokenizeEmojiText } from './emoji-text';

/** How a message is laid out, decided from its text alone (the wire format stays plain Unicode). */
export type EmojiMessageClass =
	| { kind: 'normal' }
	/** Two or three emoji, or one without an animation: large static images. */
	| { kind: 'jumbo'; emoji: string[] }
	/** Exactly one emoji that has an entry in the animated table. */
	| { kind: 'animated'; key: string; emoji: string[] };

/** Most emoji a message may hold and still be shown jumbo. */
export const MAX_JUMBO_EMOJI = 3;

/**
 * Telegram-style big emoji: exactly one emoji with an animation is animated, one without or two to three is jumbo,
 * anything else (other text, four or more) is normal. Whitespace around and between emoji is ignored; skin tones,
 * variation selectors and ZWJ sequences count as one emoji.
 *
 * @param text - Decrypted message body.
 * @param hasAnimation - Whether the animated table has the emoji key (see `emojiKey`). Omit when unavailable.
 * @param customNames - Known custom emoji names; a `:name:` among them counts as an emoji (jumbo, never animated).
 */
export function classifyEmojiMessage(
	text: string,
	hasAnimation: (key: string) => boolean = () => false,
	customNames?: ReadonlySet<string>,
): EmojiMessageClass {
	const tokens = tokenizeEmojiText(text, customNames);
	const emoji: string[] = [];
	let customCount = 0;
	for (const token of tokens) {
		if (token.type === 'emoji') emoji.push(token.value);
		else if (token.type === 'custom') customCount++;
		else if (token.value.trim() !== '') return { kind: 'normal' };
	}
	const total = emoji.length + customCount;
	if (total === 0 || total > MAX_JUMBO_EMOJI) return { kind: 'normal' };
	if (total === 1 && customCount === 0) {
		const token = tokens.find((t) => t.type === 'emoji');
		if (token?.type === 'emoji' && hasAnimation(token.key)) return { kind: 'animated', key: token.key, emoji };
	}
	return { kind: 'jumbo', emoji };
}
