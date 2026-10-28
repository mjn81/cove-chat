/** What the composer's record button captures when tapped. */
export type RecordMode = 'voice' | 'video';

// Same `cove_*` naming as the other persisted keys.
const STORAGE_KEY = 'cove_record_mode';

/** @returns the other mode (a long press on the record button flips voice <-> video). */
export function toggleRecordMode(mode: RecordMode): RecordMode {
	return mode === 'voice' ? 'video' : 'voice';
}

/** @returns the saved mode, or `voice` when nothing valid is stored or storage is unavailable. */
export function loadRecordMode(): RecordMode {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved === 'video' ? 'video' : 'voice';
	} catch {
		return 'voice';
	}
}

/** Remembers the chosen mode across sessions; failures (private mode) are ignored. */
export function saveRecordMode(mode: RecordMode): void {
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		/* the mode just resets next time */
	}
}
