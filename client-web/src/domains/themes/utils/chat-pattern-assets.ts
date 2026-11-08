import type { ChatPatternId } from '../types/themes.types';

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

/** URL of the doodle SVG for each built-in pattern (the single mapping; ids live in `chat-backgrounds.ts`). */
export const CHAT_PATTERN_URLS: Record<ChatPatternId, string> = {
	animals: animalsSvg,
	space: spaceSvg,
	games: gamesSvg,
	sweets: sweetsSvg,
	travel: travelSvg,
	nature: natureSvg,
	food: foodSvg,
	music: musicSvg,
	tech: techSvg,
	weather: weatherSvg,
};
