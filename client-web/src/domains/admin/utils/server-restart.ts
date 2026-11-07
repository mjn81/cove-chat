/** Where a "Restart server" request stands, from this browser's point of view. */
export type ServerRestartStage = 'idle' | 'restarting' | 'done';

export interface RestartStageInput {
	/** True once the owner confirmed and the server accepted the request. */
	requested: boolean;
	/** True once a poll failed after the request (the server went down). */
	sawDown: boolean;
	/** Uptime from the latest successful poll after the request, or null while no poll has succeeded yet. */
	uptimeSeconds: number | null;
	/** Uptime the server reported just before the request. */
	baselineUptime: number;
}

/**
 * Decides whether the restarted server has come back.
 *
 * A failed poll followed by a successful one proves the restart. When the restart is quick enough that no poll ever
 * failed, an uptime lower than before the request proves it instead.
 *
 * @param input - Poll observations since the request.
 * @returns `idle` before a request, `restarting` while waiting, `done` once the server answers again.
 */
export function serverRestartStage({ requested, sawDown, uptimeSeconds, baselineUptime }: RestartStageInput): ServerRestartStage {
	if (!requested) return 'idle';
	if (uptimeSeconds === null) return 'restarting';
	return sawDown || uptimeSeconds < baselineUptime ? 'done' : 'restarting';
}
