import type { PartialTokenSet, ThemeMode } from '../types/themes.types';
import { parseColorValue } from './color';
import { resolveTheme } from './resolve-theme';
import { DEFAULT_THEME_ID } from '../data/builtin-themes';
import { definitionFor } from './theme-settings';
import { THEME_TOKEN_NAMES, isThemeTokenName } from './tokens';
import type { ThemeDefinition } from '../types/themes.types';

/** The look a desktop notification popup should copy. */
export interface PopupAppearance {
	/** Whether the effective mode is dark (a dark-only theme stays dark in light mode). */
	dark: boolean;
	/** The resolved colours; empty for Cove, whose palette is the popup stylesheet's own. */
	tokens: PartialTokenSet;
}

/**
 * What the popup window needs to look like the app: the effective mode and, for any theme but Cove, its full
 * resolved token set. The popup is a separate web view without the app's settings, so this travels in the payload.
 *
 * @param themeId The selected theme id.
 * @param customTheme The stored snapshot for installed themes, `null` for built-ins.
 * @param mode The user's light/dark preference.
 */
export function activeAppearance(themeId: string, customTheme: ThemeDefinition | null, mode: ThemeMode): PopupAppearance {
	const theme = definitionFor(themeId, customTheme);
	const resolved = resolveTheme(theme, mode);
	return { dark: resolved.mode === 'dark', tokens: theme.id === DEFAULT_THEME_ID ? {} : { ...resolved.tokens } };
}

/**
 * Applies a token map received over the popup payload to `root`, replacing whatever was applied before. Names must
 * be on the allow-list and values must pass the colour grammar again here (the desktop shell filters too, but the
 * web side never trusts a payload).
 *
 * @param root The popup page's `<html>` element.
 * @param tokens Token name to `H S% L%` value; `undefined` or empty resets to the stylesheet palette.
 * @returns How many tokens were applied.
 */
export function applyTokenMap(root: HTMLElement, tokens: Record<string, string> | undefined | null): number {
	for (const name of THEME_TOKEN_NAMES) root.style.removeProperty(`--${name}`);
	let applied = 0;
	for (const [name, value] of Object.entries(tokens ?? {})) {
		if (!isThemeTokenName(name)) continue;
		const parsed = parseColorValue(value);
		if (!parsed) continue;
		root.style.setProperty(`--${name}`, parsed.value);
		applied++;
	}
	return applied;
}
