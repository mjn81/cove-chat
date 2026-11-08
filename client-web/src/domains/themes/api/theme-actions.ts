import { useAppStore } from '@/store/app.slice';
import type { ThemeDefinition } from '../types/themes.types';
import { getPreviewSession, type PreviewRequest } from '../utils/preview-session';
import { dexieThemeStore } from './dexie-theme-store';
import { installThemeFromBytes, type InstallResult, type ThemeStore } from './theme-library';

/** Where "apply" ends up: the app store's `selectTheme` in the app, a spy in tests. */
export type SelectTheme = (theme: ThemeDefinition) => void;

const selectInApp: SelectTheme = (theme) => useAppStore.getState().selectTheme(theme);

/**
 * Builds the "Apply" action for a theme that came from a file: it is installed first (the same validation and
 * image-decoding checks as an explicit install), then selected. Applying an already installed copy just selects it.
 *
 * @param bytes The `.covetheme` file contents.
 * @param store Where themes are kept.
 * @param select How the theme is made current.
 * @returns The action, resolving `true` when the theme is now in use.
 */
export function applyFromFile(
	bytes: Uint8Array,
	store: ThemeStore = dexieThemeStore,
	select: SelectTheme = selectInApp,
): () => Promise<boolean> {
	return async () => {
		const result = await installThemeFromBytes(bytes, store);
		if (!result.ok) return false;
		select(result.theme);
		return true;
	};
}

/** Installs a theme file without applying it. */
export function installFile(bytes: Uint8Array, store: ThemeStore = dexieThemeStore): Promise<InstallResult> {
	return installThemeFromBytes(bytes, store);
}

/**
 * Starts a scoped preview of `theme` under the floating bar. Nothing persists until the user chooses Apply.
 *
 * @param request The theme and the action Apply runs.
 */
export function startThemePreview(request: PreviewRequest): void {
	getPreviewSession(() => useAppStore.getState().mode).start(request);
}

/** The app-wide preview session (for the bar). */
export function previewSession() {
	return getPreviewSession(() => useAppStore.getState().mode);
}

/** The "Apply" action for a theme that is already available locally (built-in or installed). */
export function applyKnown(theme: ThemeDefinition, select: SelectTheme = selectInApp): () => Promise<boolean> {
	return async () => {
		select(theme);
		return true;
	};
}
