/** Longest video message, in seconds (the server transcodes it afterwards). */
export const MAX_VIDEO_SECONDS = 60;

/** Geometry of the square-with-rounded-corners ring drawn around the camera preview. */
const RING_SIZE = 384;
const RING_RADIUS = 48;
const RING_INSET = 4;

const MIME_CANDIDATES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];

/**
 * `m:ss` countdown label. Fractions are rounded up so a running countdown
 * never reads `0:00` before it actually ends.
 */
export function formatSecondsCeil(seconds: number): string {
	const s = Math.ceil(seconds);
	return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/**
 * First video recorder format the browser supports.
 *
 * @param isSupported - Normally `MediaRecorder.isTypeSupported`.
 * @returns An empty string when none match, so the browser picks its default.
 */
export function pickVideoMimeType(isSupported: (type: string) => boolean): string {
	return MIME_CANDIDATES.find(isSupported) ?? '';
}

/** File name and MIME type for a finished video message. */
export function videoFileMeta(blobType: string, now: number): { name: string; type: string } {
	return {
		name: `video_message_${now}.${blobType.includes('mp4') ? 'mp4' : 'webm'}`,
		type: blobType || 'video/mp4',
	};
}

/** Whether the trim handles removed more than half a second from either end (worth re-encoding for). */
export function isVideoTrimmed(start: number, end: number, duration: number): boolean {
	return start > 0.5 || end < duration - 0.5;
}

/**
 * SVG ring numbers for the countdown around the preview: the stroke is
 * dashed over the full perimeter and the offset grows as time runs out.
 *
 * @param timeLeft - Seconds remaining.
 */
export function progressRing(timeLeft: number) {
	const inner = RING_SIZE - 2 * RING_INSET;
	const perimeter = 2 * (inner - 2 * RING_RADIUS + (inner - 2 * RING_RADIUS)) + 2 * Math.PI * RING_RADIUS;
	return {
		size: RING_SIZE,
		inset: RING_INSET,
		radius: RING_RADIUS,
		innerSize: inner,
		perimeter,
		dashOffset: perimeter * (1 - timeLeft / MAX_VIDEO_SECONDS),
	};
}
