import type { ThemeDefinition, ThemeMode } from '../types/themes.types';
import { getThemeEngine, type ThemeEngine, type ThemePreviewHandle } from './theme-engine';

/** How long a preview stays on screen before it reverts by itself (plan 1.4). */
export const PREVIEW_TIMEOUT_MS = 60_000;

/** What is being previewed and how to make it permanent. */
export interface PreviewRequest {
	theme: ThemeDefinition;
	/**
	 * Makes the theme the persistent look (installing it first when it is not installed yet).
	 *
	 * @returns `true` on success; `false` keeps the preview running.
	 */
	apply: () => Promise<boolean>;
}

/** A running preview as the floating bar sees it. */
export interface ActivePreview extends PreviewRequest {
	/** Epoch milliseconds at which the preview reverts by itself. */
	expiresAt: number;
}

/** The single place previews are started from: chat cards, the Themes page and the editor. */
export interface PreviewSession {
	start: (request: PreviewRequest) => void;
	/** Ends the preview and restores the applied theme. */
	revert: () => void;
	/** Applies the previewed theme for good. Resolves `false` (and keeps previewing) if it could not be applied. */
	apply: () => Promise<boolean>;
	/** The running preview, or `null`. The object is stable between changes (usable with `useSyncExternalStore`). */
	current: () => ActivePreview | null;
	subscribe: (listener: () => void) => () => void;
}

/**
 * Wraps the engine's scoped preview with the information the bar needs. Nothing here persists: the engine never
 * writes a preview anywhere, so a reload (a fresh engine, no session) is a revert.
 *
 * @param engine The engine that paints.
 * @param getMode The user's current light/dark preference.
 */
export function createPreviewSession(engine: ThemeEngine, getMode: () => ThemeMode): PreviewSession {
	let active: ActivePreview | null = null;
	let handle: ThemePreviewHandle | null = null;
	const listeners = new Set<() => void>();
	const notify = () => listeners.forEach((l) => l());

	// The engine ends a preview on its own timer; mirror that so the bar disappears with it.
	engine.subscribe(() => {
		if (active && !engine.isPreviewing()) {
			active = null;
			handle = null;
			notify();
		}
	});

	return {
		start(request) {
			handle = engine.preview(request.theme, getMode(), { timeoutMs: PREVIEW_TIMEOUT_MS });
			active = { ...request, expiresAt: Date.now() + PREVIEW_TIMEOUT_MS };
			notify();
		},
		revert() {
			handle?.revert();
		},
		async apply() {
			const request = active;
			if (!request) return false;
			let ok = false;
			try {
				ok = await request.apply();
			} catch {
				ok = false;
			}
			// Only end the preview this apply belongs to; the user may have started another one meanwhile.
			if (ok && active === request) handle?.revert();
			return ok;
		},
		current: () => active,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

let singleton: PreviewSession | null = null;

/**
 * The app-wide preview session. The mode is read lazily from the store by the caller-supplied getter on first use.
 *
 * @param getMode Supplies the user's mode (the app passes `useAppStore.getState().mode`).
 */
export function getPreviewSession(getMode: () => ThemeMode): PreviewSession {
	singleton ??= createPreviewSession(getThemeEngine(), getMode);
	return singleton;
}
