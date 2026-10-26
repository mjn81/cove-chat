/** Number of bars in the live level meter. */
export const LIVE_BAR_COUNT = 28;

/** Candidate recorder formats, best first: Opus is small and widely supported. */
const MIME_CANDIDATES = [
	'audio/webm;codecs=opus',
	'audio/ogg;codecs=opus',
	'audio/webm',
	'audio/ogg',
	'audio/mp4',
];

/** `m:ss` for a duration in seconds. */
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Turns an analyser's frequency snapshot into bar heights (14-100 %) for the
 * live recording meter; every bar averages an equal slice of the spectrum.
 *
 * @param data - Byte frequency data from `AnalyserNode.getByteFrequencyData`.
 * @param barCount - Number of bars to produce.
 */
export function computeLiveLevels(data: Uint8Array, barCount = LIVE_BAR_COUNT): number[] {
	const step = Math.floor(data.length / barCount);
	const levels: number[] = [];
	for (let i = 0; i < barCount; i++) {
		let sum = 0;
		for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
		const avg = sum / (step || 1);
		levels.push(Math.min(100, Math.max(14, Math.round((avg / 255) * 115))));
	}
	return levels;
}

/**
 * First recorder MIME type the browser supports.
 *
 * @param isSupported - Normally `MediaRecorder.isTypeSupported`.
 * @returns `undefined` if none match, so the caller lets the browser pick.
 */
export function pickRecorderMimeType(isSupported: (type: string) => boolean): string | undefined {
	return MIME_CANDIDATES.find(isSupported);
}

/**
 * File name and MIME type for a finished voice note.
 *
 * @param blobType - `Blob.type` of the recording (WAV after trimming).
 * @param now - Timestamp used to make the name unique.
 */
export function voiceFileMeta(blobType: string, now: number): { name: string; type: string } {
	const isWav = blobType.includes('wav');
	const ext = isWav ? 'wav' : blobType.includes('ogg') ? 'ogg' : 'webm';
	return {
		name: `voice-note-${now}.${ext}`,
		type: isWav ? 'audio/wav' : blobType || 'audio/webm;codecs=opus',
	};
}
