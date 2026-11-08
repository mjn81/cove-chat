import type { PartialTokenSet, ThemeTokenName } from '../types/themes.types';
import { contrastRatio, hslToTriplet, pickForeground, tripletToHsl } from './color';
import { MIN_CONTRAST_AA, MIN_CONTRAST_HARD, READABILITY_PAIRS } from './tokens';

/** A text/surface pair below the recommended contrast, with a suggested replacement for the text colour. */
export interface ContrastIssue {
	foreground: ThemeTokenName;
	surface: ThemeTokenName;
	ratio: number;
	/** `error` is below the hard floor (the theme could not be saved), `warn` below AA. */
	level: 'error' | 'warn';
	/** A replacement for `foreground` that reaches AA against `surface`. */
	fix?: string;
}
/**
 * A text colour that reads on `surface`. It keeps the hue and saturation of `foreground` and walks the lightness
 * away from the surface until `target` is met; if the hue cannot get there, black or white is used instead.
 *
 * @param foreground The current text colour (`H S% L%`).
 * @param surface The colour it sits on.
 * @param target The contrast ratio to reach (default AA).
 * @returns `foreground` unchanged when it already passes.
 */
export function suggestForeground(foreground: string, surface: string, target: number = MIN_CONTRAST_AA): string {
	if (contrastRatio(foreground, surface) >= target) return foreground;
	const [h, s, l] = tripletToHsl(foreground);
	const surfaceLightness = tripletToHsl(surface)[2];
	// Away from the surface: lighter text on a dark surface, darker on a light one.
	const direction = surfaceLightness >= 50 ? -1 : 1;
	let best = foreground;
	let bestRatio = contrastRatio(foreground, surface);
	for (let step = 1; step <= 100; step++) {
		const next = Math.min(100, Math.max(0, l + direction * step));
		const candidate = hslToTriplet(h, s, next);
		const ratio = contrastRatio(candidate, surface);
		if (ratio > bestRatio) {
			best = candidate;
			bestRatio = ratio;
		}
		if (ratio >= target) return candidate;
		if (next === 0 || next === 100) break;
	}
	const plain = pickForeground(surface);
	return contrastRatio(plain, surface) > bestRatio ? plain : best;
}

/**
 * Text/surface pairs of a token set that are below AA (the same pairs the file validator checks), each with a fix.
 *
 * @param tokens A token set; missing tokens are skipped.
 */
export function contrastIssues(tokens: PartialTokenSet): ContrastIssue[] {
	const out: ContrastIssue[] = [];
	for (const [foreground, surface] of READABILITY_PAIRS) {
		const fg = tokens[foreground];
		const bg = tokens[surface];
		if (fg === undefined || bg === undefined) continue;
		const ratio = contrastRatio(fg, bg);
		if (ratio >= MIN_CONTRAST_AA) continue;
		out.push({
			foreground,
			surface,
			ratio,
			level: ratio < MIN_CONTRAST_HARD ? 'error' : 'warn',
			fix: suggestForeground(fg, bg),
		});
	}
	return out;
}

/**
 * Applies the suggested fixes to every text colour. Surfaces are never changed (they are the author's choice), and
 * a colour used on two surfaces (muted text) ends up readable on both.
 *
 * @param tokens A complete or partial token set.
 * @returns A new set.
 */
export function autoFixTokens<T extends PartialTokenSet>(tokens: T): T {
	const out = { ...tokens };
	// A fix for one surface can affect another pair, so repeat until stable (two passes in practice).
	for (let pass = 0; pass < 4; pass++) {
		const issues = contrastIssues(out);
		if (issues.length === 0) break;
		for (const issue of issues) {
			if (issue.fix) out[issue.foreground] = issue.fix as T[ThemeTokenName];
		}
	}
	return out;
}
