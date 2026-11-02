import type { ServerUpdateInfo } from '../types/admin.types';

/** What the update panel shows. `reconnecting` covers the gap while the server process is being replaced. */
export type ServerUpdateStage =
	| 'idle'
	| 'downloading'
	| 'installing'
	| 'restarting'
	| 'reconnecting'
	| 'done'
	| 'failed';

export interface StageInput {
	/** Latest answer from `GET /api/admin/update`, kept by React Query even while later polls fail. */
	info: ServerUpdateInfo | undefined;
	/** Version this browser asked to install; null when it did not start the update. */
	target: string | null;
	/** True when the most recent poll failed (the server is down while it restarts). */
	pollFailed: boolean;
}

/**
 * Decides which stage the panel is in.
 *
 * The browser that started the update tracks `target`: once the server answers again with that version and an
 * idle job, the update is done. A different admin watching the same panel has no target and just mirrors the
 * server's job state.
 *
 * @param input - Latest poll result, the target version and whether the last poll failed.
 * @returns The stage to render.
 */
export function serverUpdateStage({ info, target, pollFailed }: StageInput): ServerUpdateStage {
	if (target === null) {
		if (info?.state === 'downloading' || info?.state === 'installing' || info?.state === 'restarting') {
			return info.state;
		}
		return 'idle';
	}
	if (info?.state === 'idle' && info.current_version === target) return 'done';
	if (info?.state === 'failed') return 'failed';
	if (pollFailed) return 'reconnecting';
	if (info?.state === 'restarting') return 'restarting';
	if (info?.state === 'installing') return 'installing';
	return 'downloading';
}

/** True while polling must continue (an update is running or its outcome is not yet known). */
export function isUpdateBusy(stage: ServerUpdateStage): boolean {
	return stage !== 'idle' && stage !== 'done' && stage !== 'failed';
}

/**
 * Splits what the owner pasted into the checksum box: a lone 64-character hex digest is the file's SHA-256; anything
 * longer (a whole SHA256SUMS file) is sent as `sums` and matched by file name on the server.
 *
 * @param text - The pasted text.
 * @returns The field to send, or an empty object when nothing was pasted.
 */
export function classifyChecksumInput(text: string): { sha256?: string; sums?: string } {
	const trimmed = text.trim();
	if (trimmed === '') return {};
	return /^[0-9a-fA-F]{64}$/.test(trimmed) ? { sha256: trimmed.toLowerCase() } : { sums: trimmed };
}

/**
 * Returns the release notes shortened for the collapsed preview.
 *
 * @param notes - Raw release body.
 * @param max - Maximum characters before an ellipsis is appended.
 */
export function previewReleaseNotes(notes: string, max = 280): string {
	const text = notes.trim();
	return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}
