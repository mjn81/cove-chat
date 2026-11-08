import type { ChatPatternId } from '../types/themes.types';

/**
 * The one list of built-in chat doodle patterns. The picker, the renderer and the `.covetheme` validator all read
 * it; the SVG files themselves are mapped in `chat-pattern-assets.ts` (kept apart so this module stays pure).
 */
export const CHAT_PATTERN_IDS = [
	'animals',
	'space',
	'games',
	'sweets',
	'travel',
	'nature',
	'food',
	'music',
	'tech',
	'weather',
] as const satisfies readonly ChatPatternId[];

/** What the user's `chatBackground` setting can hold: no background, a pattern, or the active theme's own. */
export type ChatBackgroundChoice = 'none' | 'theme' | ChatPatternId;

/** Type guard for pattern ids. */
export function isChatPatternId(value: unknown): value is ChatPatternId {
	return typeof value === 'string' && (CHAT_PATTERN_IDS as readonly string[]).includes(value);
}

/** Type guard for the stored setting. */
export function isChatBackgroundChoice(value: unknown): value is ChatBackgroundChoice {
	return value === 'none' || value === 'theme' || isChatPatternId(value);
}
