import { COVE_TOKENS } from '../data/builtin-themes';
import type {
	ChatBackgroundConfig,
	LocalizedName,
	ThemeAsset,
	ThemeDefinition,
	ThemeMode,
	ThemeTokenName,
	TokenSet,
} from '../types/themes.types';
import { parseColorValue } from './color';
import { themeToJson, validateThemeJson } from './covetheme';
import { completeTokens, type ThemeIssue } from './tokens';

/** Which colour set of a draft is being edited: the theme's own mode, or the light variant of a dark theme. */
export type DraftVariant = 'base' | 'light';

/**
 * A theme being edited. Unlike {@link ThemeDefinition} the token sets are always complete, so every picker has a
 * value, and the background image is held as bytes next to the settings that describe it.
 */
export interface ThemeDraft {
	id: string;
	name: LocalizedName;
	author: string;
	license: string;
	base: ThemeMode;
	tokens: TokenSet;
	/** The light variant; only a dark-base theme can have one. */
	light: TokenSet | null;
	/** What sits behind the chat. `image` without {@link ThemeDraft.image} counts as no background. */
	background: ChatBackgroundConfig;
	image: ThemeAsset | null;
}

const IMAGE_EXTENSION: Record<ThemeAsset['mime'], string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
};

/**
 * A fresh theme id: a slug of the name plus a random suffix, so two themes with the same name never collide and the
 * result always passes the id grammar (lowercase letters, digits, dashes).
 *
 * @param name The display name.
 * @param random Source of randomness in [0, 1); injected in tests.
 */
export function newThemeId(name: string, random: () => number = Math.random): string {
	const slug = name
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	const suffix = Math.floor(random() * 36 ** 5)
		.toString(36)
		.padStart(4, '0');
	return `${slug.length >= 2 ? slug : 'theme'}-${suffix}`;
}

/** The asset path an image of this type gets inside the archive. */
export function backgroundAssetPath(mime: ThemeAsset['mime']): string {
	return `assets/background.${IMAGE_EXTENSION[mime]}`;
}

/**
 * Starts a draft from any theme.
 *
 * @param theme The source (built-in or installed).
 * @param assets The source's images, keyed by archive path.
 * @param options `asCopy` gives the draft a new id (always the case for built-ins, whose ids are reserved).
 */
export function draftFromTheme(
	theme: ThemeDefinition,
	assets: Record<string, ThemeAsset>,
	options: { asCopy: boolean; random?: () => number },
): ThemeDraft {
	const bg = theme.chat?.background;
	const image = bg?.type === 'image' ? (assets[bg.asset] ?? null) : null;
	return {
		id: options.asCopy ? newThemeId(theme.id, options.random) : theme.id,
		name: { ...theme.name },
		author: theme.author ?? '',
		license: theme.license ?? '',
		base: theme.base,
		tokens: completeTokens(theme.tokens, COVE_TOKENS[theme.base]),
		light: theme.base === 'dark' && theme.light ? completeTokens(theme.light, COVE_TOKENS.light) : null,
		background: bg ?? { type: 'none' },
		image,
	};
}

/** The colours of one variant (the base set when there is no light variant). */
export function tokensOf(draft: ThemeDraft, variant: DraftVariant): TokenSet {
	return variant === 'light' && draft.light ? draft.light : draft.tokens;
}

/**
 * Returns a draft with one colour changed. The value goes through the colour grammar (hex is accepted and
 * converted); an invalid value returns the draft untouched, so no pasted text can reach a token.
 */
export function setDraftToken(draft: ThemeDraft, variant: DraftVariant, name: ThemeTokenName, value: string): ThemeDraft {
	const parsed = parseColorValue(value);
	if (!parsed) return draft;
	if (variant === 'light' && draft.light) return { ...draft, light: { ...draft.light, [name]: parsed.value } };
	return { ...draft, tokens: { ...draft.tokens, [name]: parsed.value } };
}

/** Gives a dark theme a light variant, starting from the Cove light palette. Light themes cannot have one. */
export function addLightVariant(draft: ThemeDraft): ThemeDraft {
	if (draft.base !== 'dark' || draft.light) return draft;
	return { ...draft, light: { ...COVE_TOKENS.light } };
}

/** Removes the light variant. */
export function removeLightVariant(draft: ThemeDraft): ThemeDraft {
	return draft.light ? { ...draft, light: null } : draft;
}

/** Replaces the chat background setting. */
export function setDraftBackground(draft: ThemeDraft, background: ChatBackgroundConfig): ThemeDraft {
	return { ...draft, background };
}

/**
 * Sets the background image and switches the background to it (keeping fit, opacity and blur from an earlier image
 * setting). Pass `null` to remove the image.
 */
export function setDraftImage(draft: ThemeDraft, image: ThemeAsset | null): ThemeDraft {
	if (!image) {
		return { ...draft, image: null, background: draft.background.type === 'image' ? { type: 'none' } : draft.background };
	}
	const previous = draft.background.type === 'image' ? draft.background : null;
	return {
		...draft,
		image,
		background: {
			type: 'image',
			asset: backgroundAssetPath(image.mime),
			opacity: previous?.opacity ?? 1,
			blur: previous?.blur ?? 0,
			fit: previous?.fit ?? 'cover',
		},
	};
}

/** The images that ship with the draft, keyed by archive path. */
export function draftAssets(draft: ThemeDraft): Record<string, ThemeAsset> {
	return draft.background.type === 'image' && draft.image ? { [backgroundAssetPath(draft.image.mime)]: draft.image } : {};
}

/** Turns the draft into a theme definition (the shape the engine, the store and the file writer use). */
export function draftToTheme(draft: ThemeDraft): ThemeDefinition {
	const name: LocalizedName = { en: draft.name.en.trim() };
	if (draft.name.fa?.trim()) name.fa = draft.name.fa.trim();
	if (draft.name.ar?.trim()) name.ar = draft.name.ar.trim();
	const bg = draft.background;
	const background: ChatBackgroundConfig | undefined =
		bg.type === 'none' || (bg.type === 'image' && !draft.image)
			? undefined
			: bg.type === 'image' && draft.image
				? { ...bg, asset: backgroundAssetPath(draft.image.mime) }
				: bg;
	return {
		id: draft.id,
		name,
		...(draft.author.trim() ? { author: draft.author.trim() } : {}),
		...(draft.license.trim() ? { license: draft.license.trim() } : {}),
		base: draft.base,
		tokens: { ...draft.tokens },
		...(draft.base === 'dark' && draft.light ? { light: { ...draft.light } } : {}),
		...(background ? { chat: { background } } : {}),
	};
}

/**
 * Runs the same validation a received file gets, so the editor can say what would stop the theme from being saved
 * (`errors`) and what is only worth a look (`warnings`).
 */
export function draftIssues(draft: ThemeDraft): { errors: ThemeIssue[]; warnings: ThemeIssue[] } {
	const theme = draftToTheme(draft);
	const result = validateThemeJson(themeToJson(theme), draftAssets(draft));
	return result.ok ? { errors: [], warnings: result.warnings } : { errors: result.errors, warnings: result.warnings };
}
