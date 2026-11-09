import { useAnimatedEmoji, useCustomEmoji, useLoadedEmojiStyle } from '../hooks/use-emoji';

/**
 * Renders nothing. Mounted once after sign-in so the active style's sheet and index, the animated table and the
 * custom emoji start loading (and decoding) at app start instead of when the first emoji happens to scroll into
 * view; the picker and the first big emoji then appear instantly.
 */
export function EmojiPrewarm() {
	useLoadedEmojiStyle();
	useAnimatedEmoji();
	useCustomEmoji();
	return null;
}
