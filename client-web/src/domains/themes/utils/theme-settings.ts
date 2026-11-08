import { DEFAULT_THEME_ID, getBuiltinTheme, isBuiltinThemeId } from '../data/builtin-themes';
import type { ThemeDefinition, ThemeMode } from '../types/themes.types';
import { isChatBackgroundChoice, type ChatBackgroundChoice } from './chat-backgrounds';
import { revalidateThemeDefinition } from './covetheme';

/** The theme-related part of the persisted app settings. */
export interface ThemeSettings {
	/** The user's light/dark preference. */
	mode: ThemeMode;
	/** Selected theme: a built-in id or the id of `customTheme`. */
	themeId: string;
	/**
	 * Snapshot of the selected installed theme, so the first paint after a reload needs no IndexedDB round trip.
	 * `null` for built-ins.
	 */
	customTheme: ThemeDefinition | null;
	chatBackground: ChatBackgroundChoice;
}

const isMode = (v: unknown): v is ThemeMode => v === 'dark' || v === 'light';

/**
 * Turns whatever is in `localStorage['app-settings']` into valid theme settings.
 *
 * Settings saved before themes existed carry `theme: 'dark' | 'light'` and a plain pattern id; they map to the same
 * mode with Cove selected, so nobody's look changes on upgrade. Anything invalid or inconsistent falls back to Cove.
 *
 * @param persisted The stored settings object (untrusted, possibly from an older version).
 */
export function normalizeThemeSettings(persisted: unknown): ThemeSettings {
	const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Record<string, unknown>;
	const mode: ThemeMode = isMode(p.mode) ? p.mode : isMode(p.theme) ? p.theme : 'dark';

	let themeId = DEFAULT_THEME_ID;
	let customTheme: ThemeDefinition | null = null;
	if (typeof p.themeId === 'string' && isBuiltinThemeId(p.themeId)) {
		themeId = p.themeId;
	} else if (typeof p.themeId === 'string') {
		const stored = revalidateThemeDefinition(p.customTheme);
		if (stored && stored.id === p.themeId && !isBuiltinThemeId(stored.id)) {
			themeId = stored.id;
			customTheme = stored;
		}
	}

	let chatBackground: ChatBackgroundChoice = isChatBackgroundChoice(p.chatBackground) ? p.chatBackground : 'none';
	if (chatBackground === 'theme' && !(customTheme?.chat?.background && customTheme.chat.background.type !== 'none')) {
		chatBackground = 'none';
	}
	return { mode, themeId, customTheme, chatBackground };
}

/**
 * What the chat background setting becomes when the theme changes: a theme that brings its own background gets it
 * adopted, a stale "use the theme's" choice is dropped, and an explicit pattern pick is left alone.
 *
 * @param current The current choice.
 * @param next The newly selected theme.
 */
export function backgroundAfterThemeChange(current: ChatBackgroundChoice, next: ThemeDefinition): ChatBackgroundChoice {
	const bg = next.chat?.background;
	if (bg && bg.type !== 'none') return 'theme';
	return current === 'theme' ? 'none' : current;
}

/**
 * The definition behind the current selection: the stored snapshot for an installed theme, otherwise the built-in.
 * Falls back to Cove if neither is available.
 */
export function definitionFor(themeId: string, customTheme: ThemeDefinition | null): ThemeDefinition {
	if (customTheme && customTheme.id === themeId) return customTheme;
	return getBuiltinTheme(themeId) ?? (getBuiltinTheme(DEFAULT_THEME_ID) as ThemeDefinition);
}
