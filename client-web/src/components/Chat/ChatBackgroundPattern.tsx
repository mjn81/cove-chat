import React from 'react';
import { useAppStore } from '@/store/app.slice';

import animalsSvg from '@/assets/patterns/animals.svg?url';
import spaceSvg from '@/assets/patterns/space.svg?url';
import gamesSvg from '@/assets/patterns/games.svg?url';
import sweetsSvg from '@/assets/patterns/sweets.svg?url';
import travelSvg from '@/assets/patterns/travel.svg?url';
import natureSvg from '@/assets/patterns/nature.svg?url';
import foodSvg from '@/assets/patterns/food.svg?url';
import musicSvg from '@/assets/patterns/music.svg?url';
import techSvg from '@/assets/patterns/tech.svg?url';
import weatherSvg from '@/assets/patterns/weather.svg?url';

const PATTERNS = {
	animals: { src: animalsSvg, label: 'Animals' },
	space: { src: spaceSvg, label: 'Space' },
	games: { src: gamesSvg, label: 'Games' },
	sweets: { src: sweetsSvg, label: 'Sweets' },
	travel: { src: travelSvg, label: 'Travel' },
	nature: { src: natureSvg, label: 'Nature' },
	food: { src: foodSvg, label: 'Food' },
	music: { src: musicSvg, label: 'Music' },
	tech: { src: techSvg, label: 'Tech' },
	weather: { src: weatherSvg, label: 'Weather' },
} as const;

export type PatternKey = keyof typeof PATTERNS;

// Original Telegram SVG viewBox is 1440 x 2960.
// Scaled to 360px x 740px, the doodles are ~25-35px each, matching Telegram's density.
const PATTERN_WIDTH = 360;
const PATTERN_HEIGHT = 740;

/**
 * How strongly the pattern shows. Behind messages it stays a whisper so text and cards read cleanly; on the empty
 * page (no chat open) there is nothing to read over it, so it can be much clearer.
 */
const STRENGTH = { chat: 0.035, plain: 0.09 } as const;

interface ChatBackgroundPatternProps {
	/** `chat` behind a conversation (default), `plain` on the empty page. */
	variant?: keyof typeof STRENGTH;
}

export const ChatBackgroundPattern: React.FC<ChatBackgroundPatternProps> = ({ variant = 'chat' }) => {
	const chatBackground = useAppStore((s) => s.chatBackground);

	if (!chatBackground || chatBackground === 'none' || !(chatBackground in PATTERNS)) {
		return null;
	}

	const pattern = PATTERNS[chatBackground as PatternKey];

	return (
		<div
			className="absolute top-0 start-0 pointer-events-none z-0 overflow-hidden"
			style={{
				width: '100vw',
				height: '100vh',
				maskImage: `url(${pattern.src})`,
				WebkitMaskImage: `url(${pattern.src})`,
				maskSize: `${PATTERN_WIDTH}px ${PATTERN_HEIGHT}px`,
				WebkitMaskSize: `${PATTERN_WIDTH}px ${PATTERN_HEIGHT}px`,
				maskRepeat: 'repeat',
				WebkitMaskRepeat: 'repeat',
				// A tint of the foreground token melts into the background in both themes
				// (light tint on dark, dark tint on light).
				backgroundColor: `hsl(var(--foreground) / ${STRENGTH[variant]})`,
				transform: 'translateZ(0)',
				willChange: 'transform',
				contain: 'strict',
			}}
		/>
	);
};

export default ChatBackgroundPattern;
