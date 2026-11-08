import type { LocalizedName } from '../types/themes.types';

/**
 * The theme name for a UI language, falling back to English.
 *
 * @param name The theme's name map.
 * @param language An i18next language code such as `fa` or `ar-SA`; only the primary subtag is used.
 */
export function localizedThemeName(name: LocalizedName, language: string): string {
	const primary = language.split('-')[0];
	if (primary === 'fa' && name.fa) return name.fa;
	if (primary === 'ar' && name.ar) return name.ar;
	return name.en;
}
