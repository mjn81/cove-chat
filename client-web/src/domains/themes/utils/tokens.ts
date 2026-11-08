import type { PartialTokenSet, ThemeTokenName, TokenSet } from '../types/themes.types';
import { contrastRatio, parseColorValue } from './color';

/** A problem found while validating theme data. `code` is stable (UI maps it to a message); `detail` names the item. */
export interface ThemeIssue {
	code: string;
	detail?: string;
}

/**
 * The tokens every theme must define. Together they cover all text-on-surface pairs the UI relies on, so a theme
 * can never leave a surface with an inherited, mismatched text colour.
 */
export const CORE_TOKEN_NAMES = [
	'background',
	'foreground',
	'card',
	'card-foreground',
	'popover',
	'popover-foreground',
	'primary',
	'primary-foreground',
	'secondary',
	'secondary-foreground',
	'muted',
	'muted-foreground',
	'accent',
	'accent-foreground',
	'destructive',
	'destructive-foreground',
	'border',
	'input',
	'ring',
] as const satisfies readonly ThemeTokenName[];

/** Tokens a theme may omit; they fall back to the Cove values of the same mode. */
export const OPTIONAL_TOKEN_NAMES = [
	'mention-background',
	'mention-foreground',
	'mention-border',
	'success',
	'success-foreground',
	'warning',
	'warning-foreground',
	'overlay',
	'overlay-foreground',
] as const satisfies readonly ThemeTokenName[];

/**
 * The allow-list. Anything else (including `--radius`, fonts, layout variables) is dropped, so a theme can only
 * ever change colours.
 */
export const THEME_TOKEN_NAMES: readonly ThemeTokenName[] = [...CORE_TOKEN_NAMES, ...OPTIONAL_TOKEN_NAMES];

const TOKEN_SET = new Set<string>(THEME_TOKEN_NAMES);

/** Type guard for the allow-list. */
export function isThemeTokenName(name: string): name is ThemeTokenName {
	return TOKEN_SET.has(name);
}

/** Result of {@link sanitizeTokens}. */
export interface SanitizedTokens {
	tokens: PartialTokenSet;
	errors: ThemeIssue[];
	warnings: ThemeIssue[];
}

/**
 * Validates an untrusted token map: keeps allow-listed names whose values are in the colour grammar (normalised
 * and clamped), drops unknown names, and reports missing core tokens.
 *
 * @param input The raw `tokens` (or `light`) object from a theme file.
 */
export function sanitizeTokens(input: unknown): SanitizedTokens {
	const tokens: PartialTokenSet = {};
	const errors: ThemeIssue[] = [];
	const warnings: ThemeIssue[] = [];
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { tokens, errors: [{ code: 'invalid_tokens' }], warnings };
	}
	// Own enumerable keys only: `__proto__` set through JSON.parse is an own key and is simply not allow-listed.
	for (const [name, value] of Object.entries(input)) {
		if (!isThemeTokenName(name)) {
			warnings.push({ code: 'unknown_token', detail: name.slice(0, 40) });
			continue;
		}
		const parsed = parseColorValue(value);
		if (!parsed) {
			errors.push({ code: 'invalid_token_value', detail: name });
			continue;
		}
		if (parsed.clamped) warnings.push({ code: 'token_clamped', detail: name });
		tokens[name] = parsed.value;
	}
	for (const name of CORE_TOKEN_NAMES) {
		if (tokens[name] === undefined && !errors.some((e) => e.detail === name)) {
			errors.push({ code: 'missing_token', detail: name });
		}
	}
	return { tokens, errors, warnings };
}

/** Text/surface pairs of the readability guard; the editor reuses them for its warnings and fixes. */
export const READABILITY_PAIRS: ReadonlyArray<readonly [ThemeTokenName, ThemeTokenName]> = [
	['foreground', 'background'],
	['card-foreground', 'card'],
	['popover-foreground', 'popover'],
	['primary-foreground', 'primary'],
	['secondary-foreground', 'secondary'],
	['muted-foreground', 'background'],
	['muted-foreground', 'muted'],
	['accent-foreground', 'accent'],
	['destructive-foreground', 'destructive'],
];

/** Below this a pair is refused: text is effectively unreadable. */
export const MIN_CONTRAST_HARD = 3;
/** Below this a pair is accepted but flagged (WCAG AA for normal text). */
export const MIN_CONTRAST_AA = 4.5;

/**
 * Readability guard. A theme whose text barely differs from its surface could make the app unusable (or hide
 * buttons), so such sets are refused; mediocre ones pass with a warning.
 *
 * @param tokens A token set containing the core tokens.
 */
export function checkReadability(tokens: PartialTokenSet): { errors: ThemeIssue[]; warnings: ThemeIssue[] } {
	const errors: ThemeIssue[] = [];
	const warnings: ThemeIssue[] = [];
	for (const [fg, bg] of READABILITY_PAIRS) {
		const a = tokens[fg];
		const b = tokens[bg];
		if (a === undefined || b === undefined) continue;
		const ratio = contrastRatio(a, b);
		const detail = `${fg}/${bg}`;
		if (ratio < MIN_CONTRAST_HARD) errors.push({ code: 'low_contrast', detail });
		else if (ratio < MIN_CONTRAST_AA) warnings.push({ code: 'low_contrast', detail });
	}
	const p = tokens.primary;
	const bg = tokens.background;
	if (p !== undefined && bg !== undefined && contrastRatio(p, bg) < 1.5) {
		warnings.push({ code: 'low_contrast', detail: 'primary/background' });
	}
	return { errors, warnings };
}

/**
 * Fills the tokens a theme left out from `fallback`.
 *
 * @param tokens The theme's own tokens.
 * @param fallback A complete set (the Cove palette of the same mode).
 */
export function completeTokens(tokens: PartialTokenSet, fallback: TokenSet): TokenSet {
	const out = { ...fallback };
	for (const name of THEME_TOKEN_NAMES) {
		const v = tokens[name];
		if (v !== undefined) out[name] = v;
	}
	return out;
}

/** Maps token names to CSS custom property names, e.g. for React's `style` prop on a preview. */
export function tokensToCssVars(tokens: PartialTokenSet): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of THEME_TOKEN_NAMES) {
		const v = tokens[name];
		if (v !== undefined) out[`--${name}`] = v;
	}
	return out;
}
