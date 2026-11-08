/**
 * Pure resolution rules for the per-device emoji settings, kept out of the store so they can be tested and reused
 * by the renderer, the picker and the settings page.
 */

/** The device's own emoji font: no assets, always available, the fallback of every other style. */
export const NATIVE_STYLE = 'native';

/**
 * Picks the style to draw with: the user's choice while the server still offers it, otherwise the server default,
 * otherwise native. A stale choice (the admin disabled that style) therefore degrades instead of breaking.
 *
 * @param preferred - The user's saved choice, or null for "follow the server default".
 * @param enabled - Style ids the server offers (`enabled_styles`); empty/undefined when the server has no packs.
 * @param serverDefault - The server's default style id.
 */
export function resolveEmojiStyle(
	preferred: string | null,
	enabled: readonly string[] | undefined,
	serverDefault: string | undefined,
): string {
	if (!enabled || enabled.length === 0) return NATIVE_STYLE;
	if (preferred && enabled.includes(preferred)) return preferred;
	if (serverDefault && enabled.includes(serverDefault)) return serverDefault;
	return enabled[0];
}

/**
 * Whether big emoji and animated stickers may move: an explicit user choice wins, otherwise they follow the
 * operating system's "reduce motion" preference.
 *
 * @param preferred - The user's saved switch, or null for "automatic".
 * @param prefersReducedMotion - Result of `prefers-reduced-motion: reduce`.
 */
export function resolveAnimated(preferred: boolean | null, prefersReducedMotion: boolean): boolean {
	return preferred ?? !prefersReducedMotion;
}

/** How many recently used emoji the picker remembers. */
export const MAX_RECENT_EMOJI = 32;

/**
 * Moves an emoji key to the front of the recents list, de-duplicated and capped.
 *
 * @param recents - Current list, newest first.
 * @param key - The emoji (the unicode character or `:name:` for a custom emoji) that was just used.
 * @param max - List cap.
 */
export function pushRecent(recents: readonly string[], key: string, max = MAX_RECENT_EMOJI): string[] {
	return [key, ...recents.filter((k) => k !== key)].slice(0, max);
}
