/** DTOs for the desktop auto-updater. Field names mirror `client-desktop/internal/updater` (snake_case JSON). */

export type DesktopUpdatePhase =
	| 'idle'
	| 'checking'
	| 'available'
	| 'downloading'
	| 'ready'
	| 'installing'
	| 'error';

/** Error codes set by the updater when `phase` is `error`. */
export type DesktopUpdateError =
	| 'check_failed'
	| 'download_failed'
	| 'checksum'
	| 'install_failed'
	| 'unsupported'
	| 'nothing_staged';

export interface DesktopUpdateState {
	phase: DesktopUpdatePhase;
	current_version: string;
	/** Empty when nothing newer is known. */
	latest_version: string;
	release_notes: string;
	release_url: string;
	progress_percent: number;
	error: DesktopUpdateError | '';
	/** RFC3339 time of the last completed check, empty before the first one. */
	checked_at: string;
	up_to_date: boolean;
	/** False when the install location is read-only; the UI then points to the download page. */
	can_install: boolean;
}

export interface DesktopUpdateSettings {
	enabled: boolean;
	include_prerelease: boolean;
	/** Download in the background after a check. Off by default; installing always needs a click. */
	auto_download: boolean;
	/** Release manifest URL (update source). */
	manifest_url: string;
}
