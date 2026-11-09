import { useEffect } from 'react';

import { useActiveEmojiStyleId, useAnimatedEmoji, useCustomEmoji, useLoadedEmojiStyle } from '../hooks/use-emoji';
import { NATIVE_STYLE } from '../utils/emoji-settings';

/**
 * Renders nothing. Mounted once after sign-in so the active style's sheet and index, the animated table and the
 * custom emoji start loading (and decoding) at app start instead of when the first emoji happens to scroll into
 * view; the picker and the first big emoji then appear instantly.
 *
 * It also tells the stylesheet which emoji font to use for text that is drawn as glyphs (the composer, previews while
 * a sheet loads): the bundled Noto Color Emoji by default, the operating system's fonts only for the "Device emoji" style.
 */
export function EmojiPrewarm() {
	const style = useActiveEmojiStyleId();
	useLoadedEmojiStyle();
	useAnimatedEmoji();
	useCustomEmoji();
	useEffect(() => {
		document.documentElement.dataset.emoji = style === NATIVE_STYLE ? 'device' : 'noto';
	}, [style]);
	return null;
}
