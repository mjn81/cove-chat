import React from 'react';
import { useAppStore } from '@/store/app.slice';
import { useThemeAssetUrl } from '@/domains/themes/hooks/use-theme-asset-url';
import { CHAT_PATTERN_URLS } from '@/domains/themes/utils/chat-pattern-assets';
import { chatBackgroundStyle, resolveChatBackground } from '@/domains/themes/utils/chat-background-style';
import { definitionFor } from '@/domains/themes/utils/theme-settings';

/**
 * How strongly a pattern shows. Behind messages it stays a whisper so text and cards read cleanly; on the empty
 * page (no chat open) there is nothing to read over it, so it can be much clearer.
 */
const STRENGTH = { chat: 0.035, plain: 0.09 } as const;

interface ChatBackgroundPatternProps {
	/** `chat` behind a conversation (default), `plain` on the empty page. */
	variant?: keyof typeof STRENGTH;
}

/**
 * Draws the chat background chosen in Settings: one of the doodle patterns, or whatever the active theme carries
 * (colour, gradient, or an image stored with the theme).
 */
export const ChatBackgroundPattern: React.FC<ChatBackgroundPatternProps> = ({ variant = 'chat' }) => {
	const choice = useAppStore((s) => s.chatBackground);
	const themeId = useAppStore((s) => s.themeId);
	const customTheme = useAppStore((s) => s.customTheme);

	const config = resolveChatBackground(choice, definitionFor(themeId, customTheme));
	const imageUrl = useThemeAssetUrl(themeId, config.type === 'image' ? config.asset : null);

	const style = chatBackgroundStyle(config, {
		strength: STRENGTH[variant],
		patternUrl: config.type === 'pattern' ? CHAT_PATTERN_URLS[config.pattern] : undefined,
		imageUrl,
	});
	if (!style) return null;

	return (
		<div
			className="absolute top-0 start-0 pointer-events-none z-0 overflow-hidden"
			style={{
				width: '100vw',
				height: '100vh',
				transform: 'translateZ(0)',
				willChange: 'transform',
				contain: 'strict',
				...style,
			}}
		/>
	);
};

export default ChatBackgroundPattern;
