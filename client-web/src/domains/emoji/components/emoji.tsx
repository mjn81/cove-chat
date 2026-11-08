import { memo, useMemo } from 'react';

import { useAssetUrl } from '@/lib/asset-cache';
import { useCustomEmoji, useLoadedEmojiStyle } from '../hooks/use-emoji';
import { emojiKey, tokenizeEmojiText } from '../utils/emoji-text';
import { spriteStyle } from '../utils/sprite';
import type { LoadedEmojiStyle } from '../types/emoji.types';

interface EmojiProps {
	/** The emoji character exactly as typed or received; it stays in the DOM so copy and paste yields Unicode. */
	char: string;
	/** Rendered size in CSS pixels. */
	size?: number;
	/** Style id to draw with; defaults to the user's active style. */
	styleId?: string;
	className?: string;
}

interface EmojiSpriteProps {
	char: string;
	size: number;
	/** The decoded style to draw from; null draws the device glyph. */
	loaded: LoadedEmojiStyle | null;
	className?: string;
}

/**
 * Hook-free emoji drawing, shared by {@link Emoji} and the picker (which renders thousands of them and so resolves
 * the style once for the whole grid). The original character stays the element's text, transparent over the image,
 * so selection and copy produce real Unicode.
 */
export function EmojiSprite({ char, size, loaded, className }: EmojiSpriteProps) {
	const sprite = loaded ? spriteStyle(loaded.sheetUrl, loaded.index, emojiKey(char), size) : null;
	if (!sprite) {
		return (
			<span className={className} style={size > 28 ? { fontSize: size * 0.85, lineHeight: 1 } : undefined}>
				{char}
			</span>
		);
	}
	return (
		<span
			role="img"
			aria-label={char}
			className={`inline-block shrink-0 overflow-hidden align-text-bottom text-transparent ${className ?? ''}`}
			style={{ ...sprite, width: size, height: size, fontSize: size * 0.8, lineHeight: `${size}px` }}
		>
			{char}
		</span>
	);
}

/**
 * One emoji drawn from the active style's sprite sheet. While the sheet is loading, when the style is `native`, or
 * when the style has no image for this emoji, the device glyph is shown instead, so nothing ever blocks or goes
 * missing.
 *
 * @param char - The emoji character.
 * @param size - Size in px (default 20).
 */
export const Emoji = memo(function Emoji({ char, size = 20, styleId, className }: EmojiProps) {
	const loaded = useLoadedEmojiStyle(styleId);
	return <EmojiSprite char={char} size={size} loaded={loaded} className={className} />;
});

interface CustomEmojiImageProps {
	name: string;
	url: string;
	size?: number;
	className?: string;
}

/** A custom emoji image (fetched through the authenticated asset cache). `alt` is the `:name:` shortcode. */
export const CustomEmojiImage = memo(function CustomEmojiImage({ name, url, size = 20, className }: CustomEmojiImageProps) {
	const src = useAssetUrl(url);
	if (!src) {
		return (
			<span className={className} role="img" aria-label={`:${name}:`}>
				{`:${name}:`}
			</span>
		);
	}
	return (
		<img
			src={src}
			alt={`:${name}:`}
			draggable={false}
			width={size}
			height={size}
			className={`inline-block align-text-bottom object-contain ${className ?? ''}`}
			style={{ width: size, height: size }}
		/>
	);
});

interface EmojiTextProps {
	text: string;
	/** Emoji size in px; text around it is left to the parent's font. */
	size?: number;
}

/**
 * Plain text with its emoji and known `:name:` shortcodes drawn as images. Unknown shortcodes stay as typed.
 * Used for message text, reactions and previews.
 *
 * @param text - Text that may contain emoji.
 * @param size - Emoji size in px.
 */
export const EmojiText = memo(function EmojiText({ text, size = 20 }: EmojiTextProps) {
	const { names, byName } = useCustomEmoji();
	const tokens = useMemo(() => tokenizeEmojiText(text, names), [text, names]);
	return (
		<>
			{tokens.map((token, i) => {
				if (token.type === 'emoji') return <Emoji key={i} char={token.value} size={size} />;
				if (token.type === 'custom') {
					const item = byName.get(token.name);
					return item ? (
						<CustomEmojiImage key={i} name={item.name} url={item.url} size={size} />
					) : (
						token.value
					);
				}
				return token.value;
			})}
		</>
	);
});
