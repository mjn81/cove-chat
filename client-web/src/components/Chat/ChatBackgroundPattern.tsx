import React from 'react';
import { useAppStore } from '@/store/app.slice';

import animalsSvg from '@/assets/patterns/animals.svg?url';
import spaceSvg from '@/assets/patterns/space.svg?url';
import gamesSvg from '@/assets/patterns/games.svg?url';
import sweetsSvg from '@/assets/patterns/sweets.svg?url';

export const PATTERNS = {
	animals: { src: animalsSvg, label: 'Animals' },
	space: { src: spaceSvg, label: 'Space' },
	games: { src: gamesSvg, label: 'Games' },
	sweets: { src: sweetsSvg, label: 'Sweets' },
} as const;

export type PatternKey = keyof typeof PATTERNS;

// Original Telegram SVG viewBox is 1440 x 2960.
// Scaled to 360px x 740px, the doodles are ~25-35px each, matching Telegram's density.
const PATTERN_WIDTH = 360;
const PATTERN_HEIGHT = 740;

export const ChatBackgroundPattern: React.FC = () => {
	const chatBackground = useAppStore((s) => s.chatBackground);
	const theme = useAppStore((s) => s.theme);

	if (!chatBackground || chatBackground === 'none' || !(chatBackground in PATTERNS)) {
		return null;
	}

	const pattern = PATTERNS[chatBackground as PatternKey];

	return (
		<div
			className="absolute inset-0 pointer-events-none z-0 overflow-hidden"
			style={{
				maskImage: `url(${pattern.src})`,
				WebkitMaskImage: `url(${pattern.src})`,
				maskSize: `${PATTERN_WIDTH}px ${PATTERN_HEIGHT}px`,
				WebkitMaskSize: `${PATTERN_WIDTH}px ${PATTERN_HEIGHT}px`,
				maskRepeat: 'repeat',
				WebkitMaskRepeat: 'repeat',
				// Ultra-faint ambient watermark that seamlessly melts into the background:
				// In dark mode: softly blends with #313338 at 1.8% white tint
				// In light mode: softly blends with white at 2.5% dark tint
				backgroundColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.018)' : 'rgba(0, 0, 0, 0.025)',
			}}
		/>
	);
};

export default ChatBackgroundPattern;
