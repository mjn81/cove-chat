import { useMemo } from 'react';

import { classifyEmojiMessage, type EmojiMessageClass } from '../utils/classify-emoji-message';
import { useAnimatedEmoji, useAnimatedEnabled, useCustomEmoji } from './use-emoji';

const NORMAL: EmojiMessageClass = { kind: 'normal' };

/**
 * How a text message should be laid out (normal, jumbo or one big animated emoji), with the user's "Animated emoji"
 * setting applied: when animations are off a single emoji falls back to the static jumbo image.
 *
 * @param text - Decrypted message text, if known.
 */
export function useEmojiMessageClass(text: string | undefined): EmojiMessageClass {
	const { has } = useAnimatedEmoji();
	const animate = useAnimatedEnabled();
	const { names } = useCustomEmoji();
	return useMemo(() => {
		// Cheap exit for ordinary messages: a long text is never a handful of emoji.
		if (!text || text.length > 120) return NORMAL;
		return classifyEmojiMessage(text, animate ? has : undefined, names);
	}, [text, has, animate, names]);
}
