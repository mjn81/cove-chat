import type { CSSProperties } from 'react';
import type { ChatBackgroundConfig, ThemeDefinition } from '../types/themes.types';
import type { ChatBackgroundChoice } from './chat-backgrounds';
import { isChatPatternId } from './chat-backgrounds';

/**
 * The background to draw for the user's choice: a pattern, or the one the active theme carries.
 *
 * @param choice The `chatBackground` setting.
 * @param theme The active theme.
 */
export function resolveChatBackground(choice: ChatBackgroundChoice, theme: ThemeDefinition): ChatBackgroundConfig {
	if (choice === 'theme') return theme.chat?.background ?? { type: 'none' };
	if (isChatPatternId(choice)) return { type: 'pattern', pattern: choice };
	return { type: 'none' };
}

/** Inputs the style builder cannot know by itself. */
export interface BackgroundStyleInput {
	/** Opacity of a pattern's tint (how loud the doodles are). */
	strength: number;
	/** URL of the pattern SVG, once resolved. */
	patternUrl?: string;
	/** `blob:` URL of the theme image, once read from storage. */
	imageUrl?: string | null;
}

/** Pattern tile size in px; matches the original Telegram-style density. */
const PATTERN_SIZE = '360px 740px';

/**
 * Turns a background config into inline style for the layer behind the messages.
 *
 * Only validated values are interpolated (canonical triplets, clamped numbers), and an image must be a `blob:` URL
 * created from the theme's own stored bytes: a theme can never make the app fetch anything from the network.
 *
 * @returns The style, or `null` when there is nothing to draw (yet).
 */
export function chatBackgroundStyle(config: ChatBackgroundConfig, input: BackgroundStyleInput): CSSProperties | null {
	switch (config.type) {
		case 'none':
			return null;
		case 'pattern': {
			if (!input.patternUrl) return null;
			const url = `url(${input.patternUrl})`;
			return {
				maskImage: url,
				WebkitMaskImage: url,
				maskSize: PATTERN_SIZE,
				WebkitMaskSize: PATTERN_SIZE,
				maskRepeat: 'repeat',
				WebkitMaskRepeat: 'repeat',
				// A tint of the foreground token melts into the background in every theme (light on dark, dark on light).
				backgroundColor: `hsl(var(--foreground) / ${input.strength})`,
			};
		}
		case 'color':
			return { backgroundColor: `hsl(${config.color})` };
		case 'gradient':
			return { backgroundImage: `linear-gradient(${config.angle}deg, hsl(${config.from}), hsl(${config.to}))` };
		case 'image': {
			if (!input.imageUrl || !/^blob:[A-Za-z0-9:/._-]+$/.test(input.imageUrl)) return null;
			return {
				backgroundImage: `url("${input.imageUrl}")`,
				backgroundSize: config.fit === 'tile' ? 'auto' : config.fit,
				backgroundRepeat: config.fit === 'tile' ? 'repeat' : 'no-repeat',
				backgroundPosition: 'center',
				opacity: config.opacity,
				...(config.blur > 0 ? { filter: `blur(${config.blur}px)` } : {}),
			};
		}
	}
}
