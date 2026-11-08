import { COVE_TOKENS } from '../data/builtin-themes';
import type { ResolvedTheme, ThemeDefinition, ThemeMode } from '../types/themes.types';
import { completeTokens } from './tokens';

/**
 * Picks the variant of a theme for the user's mode and completes it.
 *
 * A theme that has no variant for the requested mode keeps its own base look, and the returned `mode` says so: a
 * dark-only theme asked for light mode stays dark, so the `dark` class (and every `dark:` utility) matches what is
 * actually on screen.
 *
 * @param theme A validated theme.
 * @param mode The user's preferred mode.
 */
export function resolveTheme(theme: ThemeDefinition, mode: ThemeMode): ResolvedTheme {
	if (mode === theme.base) {
		return { mode, tokens: completeTokens(theme.tokens, COVE_TOKENS[mode]) };
	}
	// Only a dark-base theme can carry a light variant.
	if (mode === 'light' && theme.light) {
		return { mode: 'light', tokens: completeTokens(theme.light, COVE_TOKENS.light) };
	}
	return { mode: theme.base, tokens: completeTokens(theme.tokens, COVE_TOKENS[theme.base]) };
}

/** Whether the user's mode switch changes anything for this theme. */
export function supportsBothModes(theme: ThemeDefinition): boolean {
	return theme.base === 'dark' && theme.light !== undefined;
}
