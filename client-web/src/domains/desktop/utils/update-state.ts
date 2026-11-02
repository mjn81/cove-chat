import type {
	DesktopUpdateError,
	DesktopUpdatePhase,
	DesktopUpdateSettings,
	DesktopUpdateState,
} from '../types/update.types';

const PHASES: readonly string[] = ['idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'error'];
const ERRORS: readonly string[] = [
	'check_failed',
	'download_failed',
	'checksum',
	'install_failed',
	'unsupported',
	'nothing_staged',
];

/** Cove's own update source; the desktop app uses it when no mirror is configured. */
export const DEFAULT_MANIFEST_URL = 'https://covechat.dev/releases/manifest.json';

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
	return {
		enabled: value.enabled,
		include_prerelease: value.include_prerelease,
		auto_download: value.auto_download === true,
		manifest_url: typeof value.manifest_url === 'string' ? value.manifest_url : DEFAULT_MANIFEST_URL,
	};
}

/** What the sidebar update icon offers; null hides the icon. */
export type EntryKind = 'download' | 'downloading' | 'restart' | 'manual';

/**
 * Decides whether the small update icon above the profile shows, and what its popover offers. Nothing downloads or
 * installs without a click, so an update that was only found shows `download`; a staged one shows `restart`.
 *
 * @param state - Current updater state, or null before the first one arrives.
 * @returns `download` (found, not fetched), `downloading`, `restart` (ready and installable), `manual` (found but the
 * install location is read-only: link to the release page), or null.
 */
export function entryKind(state: DesktopUpdateState | null): EntryKind | null {
	if (!state || !state.latest_version) return null;
	switch (state.phase) {
		case 'available':
			return state.can_install ? 'download' : 'manual';
		case 'downloading':
			return 'downloading';
		case 'ready':
		case 'installing':
			return state.can_install ? 'restart' : 'manual';
		default:
			return null;
	}
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
