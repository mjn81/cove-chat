import type {
	DesktopUpdateError,
	DesktopUpdatePhase,
	DesktopUpdateSettings,
	DesktopUpdateState,
} from '../types/update.types';

const PHASES: readonly string[] = ['idle', 'checking', 'downloading', 'ready', 'installing', 'error'];
const ERRORS: readonly string[] = [
	'check_failed',
	'download_failed',
	'checksum',
	'install_failed',
	'unsupported',
	'nothing_staged',
];

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

/**
 * Validates a value coming over the Wails bridge (an event payload or a JSON string) and fills missing fields, so
 * the UI never sees a half-formed state.
 *
 * @param raw - A JSON string, an already-parsed object, or anything else.
 * @returns The state, or null when `raw` is not an updater state.
 */
export function parseUpdateState(raw: unknown): DesktopUpdateState | null {
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!isRecord(value) || typeof value.phase !== 'string' || !PHASES.includes(value.phase)) return null;
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	return {
		phase: value.phase as DesktopUpdatePhase,
		current_version: str(value.current_version),
		latest_version: str(value.latest_version),
		release_notes: str(value.release_notes),
		release_url: str(value.release_url),
		progress_percent: typeof value.progress_percent === 'number' ? value.progress_percent : 0,
		error: typeof value.error === 'string' && ERRORS.includes(value.error) ? (value.error as DesktopUpdateError) : '',
		checked_at: str(value.checked_at),
		up_to_date: value.up_to_date === true,
		can_install: value.can_install === true,
	};
}

/** Validates the JSON returned by `GetUpdateSettings`. */
export function parseUpdateSettings(raw: unknown): DesktopUpdateSettings | null {
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.include_prerelease !== 'boolean') {
		return null;
	}
	return { enabled: value.enabled, include_prerelease: value.include_prerelease };
}

/** What the "Update ready" banner should offer for a state, or null to hide it. */
export type BannerKind = 'restart' | 'download';

/**
 * Decides whether the app-shell banner shows. It appears only once a verified update is staged, and not again for a
 * version the user dismissed with "Later" (the next, newer version shows it again).
 *
 * @param state - Current updater state, or null before the first one arrives.
 * @param dismissedVersion - Version the user dismissed, if any.
 * @returns `restart` when the app can install it, `download` when it cannot (read-only install), else null.
 */
export function bannerKind(state: DesktopUpdateState | null, dismissedVersion: string | null): BannerKind | null {
	if (!state || state.phase !== 'ready' || !state.latest_version) return null;
	if (state.latest_version === dismissedVersion) return null;
	return state.can_install ? 'restart' : 'download';
}

/** Reasons to ask before restarting. */
export type RestartGuard = 'ok' | 'call' | 'draft' | 'call_and_draft';

/**
 * Restarting closes the window, so a running call would drop and an unsent message would be lost. The updater never
 * restarts on its own; this tells the UI whether the user's click needs an extra confirmation.
 *
 * @param ctx - Whether a call is active and whether any chat has an unsent draft.
 */
export function restartGuard(ctx: { inCall: boolean; hasDraft: boolean }): RestartGuard {
	if (ctx.inCall && ctx.hasDraft) return 'call_and_draft';
	if (ctx.inCall) return 'call';
	if (ctx.hasDraft) return 'draft';
	return 'ok';
}

/** True while an update operation runs and the settings buttons should be disabled. */
export function isUpdateBusy(state: DesktopUpdateState | null): boolean {
	return state?.phase === 'checking' || state?.phase === 'downloading' || state?.phase === 'installing';
}
