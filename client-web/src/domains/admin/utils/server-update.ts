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
 * Returns the release notes shortened for the collapsed preview.
 *
 * @param notes - Raw release body.
 * @param max - Maximum characters before an ellipsis is appended.
 */
export function previewReleaseNotes(notes: string, max = 280): string {
	const text = notes.trim();
	return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}
