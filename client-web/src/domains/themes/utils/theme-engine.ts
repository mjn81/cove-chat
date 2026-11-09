import { COVE_TOKENS, DEFAULT_THEME_ID } from '../data/builtin-themes';
import type { ResolvedTheme, ThemeDefinition, ThemeMode } from '../types/themes.types';
import { parseColorValue } from './color';
import { resolveTheme } from './resolve-theme';
import { THEME_TOKEN_NAMES } from './tokens';

/** Options for {@link ThemeEngine.preview}. */
export interface PreviewOptions {
	/** Revert automatically after this many milliseconds (the preview bar uses 60 000). */
	timeoutMs?: number;
}

/** Handle for a running preview. */
export interface ThemePreviewHandle {
	/** Ends this preview and restores the applied theme. Does nothing if it was already replaced or reverted. */
	revert: () => void;
}

/**
 * The one place theme tokens reach the DOM.
 *
 * Tokens are written with `style.setProperty` on the root element, one allow-listed name at a time, after the value
 * passed the colour grammar again (the definitions were validated on the way in, this is the last line of defence).
 * No stylesheet text is ever built, so the app's CSP stays untouched and a theme cannot smuggle in CSS.
 */
export interface ThemeEngine {
	/** Applies a theme as the persistent look. While a preview runs the preview stays on screen. */
	apply: (theme: ThemeDefinition, mode: ThemeMode) => ResolvedTheme;
	/** Temporarily shows a theme without changing what `apply` last set; see {@link ThemePreviewHandle}. */
	preview: (theme: ThemeDefinition, mode: ThemeMode, options?: PreviewOptions) => ThemePreviewHandle;
	/** Whether a preview is currently on screen. */
	isPreviewing: () => boolean;
	/** Called when a preview starts or ends. Returns the unsubscribe function. */
	subscribe: (listener: () => void) => () => void;
}

/**
 * Creates an engine bound to a root element (the real app uses `document.documentElement`).
 *
 * @param root The element that carries the mode class and the inline custom properties.
 */
export function createThemeEngine(root: HTMLElement): ThemeEngine {
	let applied: { theme: ThemeDefinition; mode: ThemeMode } | null = null;
	let previewing: { token: symbol; timer: ReturnType<typeof setTimeout> | undefined } | null = null;
	const listeners = new Set<() => void>();
	const notify = () => listeners.forEach((l) => l());

	function paint(theme: ThemeDefinition, mode: ThemeMode): ResolvedTheme {
		const resolved = resolveTheme(theme, mode);
		root.classList.remove('dark', 'light');
		root.classList.add(resolved.mode);

		if (theme.id === DEFAULT_THEME_ID) {
			// Cove is the stylesheet's own palette: removing the overrides keeps the default look exactly as shipped.
			for (const name of THEME_TOKEN_NAMES) root.style.removeProperty(`--${name}`);
			root.removeAttribute('data-cove-theme');
			return resolved;
		}
		for (const name of THEME_TOKEN_NAMES) {
			const parsed = parseColorValue(resolved.tokens[name]);
			// A value that fails the grammar falls back to Cove's, never to something unchecked.
			root.style.setProperty(`--${name}`, parsed ? parsed.value : COVE_TOKENS[resolved.mode][name]);
		}
		root.setAttribute('data-cove-theme', theme.id);
		return resolved;
	}

	function endPreview() {
		if (!previewing) return;
		clearTimeout(previewing.timer);
		previewing = null;
		if (applied) paint(applied.theme, applied.mode);
		notify();
	}

	return {
		apply(theme, mode) {
			applied = { theme, mode };
			if (previewing) return resolveTheme(theme, mode);
			return paint(theme, mode);
		},
		preview(theme, mode, options = {}) {
			if (previewing) clearTimeout(previewing.timer);
			const token = Symbol('preview');
			previewing = { token, timer: undefined };
			if (options.timeoutMs !== undefined) {
				previewing.timer = setTimeout(() => {
					if (previewing?.token === token) endPreview();
				}, options.timeoutMs);
			}
			paint(theme, mode);
			notify();
			return {
				revert() {
					if (previewing?.token === token) endPreview();
				},
			};
		},
		isPreviewing: () => previewing !== null,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

let singleton: ThemeEngine | null = null;

/** The app-wide engine, bound to `<html>`. Created on first use so tests and SSR-free imports stay side-effect free. */
export function getThemeEngine(): ThemeEngine {
	singleton ??= createThemeEngine(document.documentElement);
	return singleton;
}
