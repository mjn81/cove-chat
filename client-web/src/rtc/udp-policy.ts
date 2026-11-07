/** Pure policies for the UDP media path (docs/udp-media.md sections 4 and 7), kept apart from WebCodecs for testing. */

/** Suggested sender bitrates from docs/udp-media.md section 7. */
export const CAMERA_BITRATE = 1_500_000;
export const SCREEN_BITRATE = 3_000_000;
/** Opus at 48 kHz mono, 20 ms packets. */
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_FRAME_MS = 20;
/** A frame must fit 64 fragments of 1100 bytes. */
export const MAX_FRAME_BYTES = 64 * 1100;

/** WebCodecs configuration for Constrained Baseline H.264 in Annex-B, the protocol's mandatory video codec. */
export function h264EncoderConfig(width: number, height: number, framerate: number, bitrate: number): VideoEncoderConfig {
	return {
		codec: 'avc1.42001f',
		width,
		height,
		framerate,
		bitrate,
		latencyMode: 'realtime',
		avc: { format: 'annexb' },
	};
}

/** Decoder configuration matching {@link h264EncoderConfig}. */
export const H264_DECODER_CONFIG: VideoDecoderConfig = { codec: 'avc1.42001f' };

/** Opus encoder configuration with in-band FEC and DTX as the protocol recommends. */
export const OPUS_ENCODER_CONFIG: AudioEncoderConfig = {
	codec: 'opus',
	sampleRate: AUDIO_SAMPLE_RATE,
	numberOfChannels: 1,
	bitrate: 32_000,
	opus: { frameDuration: AUDIO_FRAME_MS * 1000, useinbandfec: true, usedtx: true },
} as AudioEncoderConfig;

/** Which WebCodecs pieces the current webview offers. */
export interface CodecSupport {
	audio: boolean;
	video: boolean;
}

/**
 * Feature-detects WebCodecs Opus and H.264 plus the track processor needed to feed them.
 * Calls are only offered when audio works; video features are reported separately so audio-only calls still run.
 */
export async function detectCodecSupport(
	g: Partial<{
		AudioEncoder: typeof AudioEncoder;
		AudioDecoder: typeof AudioDecoder;
		VideoEncoder: typeof VideoEncoder;
		VideoDecoder: typeof VideoDecoder;
		MediaStreamTrackProcessor: unknown;
	}> = globalThis as never,
): Promise<CodecSupport> {
	const ok = async (f: () => Promise<{ supported?: boolean }>): Promise<boolean> => {
		try {
			return !!(await f()).supported;
		} catch {
			return false;
		}
	};
	const proc = !!g.MediaStreamTrackProcessor;
	const audio =
		proc &&
		!!g.AudioEncoder &&
		!!g.AudioDecoder &&
		(await ok(() => g.AudioEncoder!.isConfigSupported(OPUS_ENCODER_CONFIG))) &&
		(await ok(() => g.AudioDecoder!.isConfigSupported({ codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 1 })));
	const video =
		proc &&
		!!g.VideoEncoder &&
		!!g.VideoDecoder &&
		(await ok(() => g.VideoEncoder!.isConfigSupported(h264EncoderConfig(1280, 720, 30, CAMERA_BITRATE)))) &&
		(await ok(() => g.VideoDecoder!.isConfigSupported(H264_DECODER_CONFIG)));
	return { audio, video };
}

/** Playout state for one remote audio stream. */
export interface PlayoutState {
	/** AudioContext time at which the next decoded chunk should start. */
	next: number;
}

/**
 * Schedules a decoded audio chunk. Chunks are chained back to back; if the queue ran dry (or the first chunk
 * arrives) playback restarts `leadSeconds` in the future, which is the jitter buffer.
 *
 * @returns the start time and the new state.
 */
export function schedulePlayout(
	state: PlayoutState | null,
	now: number,
	durationSeconds: number,
	leadSeconds = 0.06,
	maxQueueSeconds = 0.4,
): { start: number; state: PlayoutState } {
	let start = state?.next ?? 0;
	// Underrun, or the queue grew too long (latency creep): resynchronise.
	if (!state || start < now || start - now > maxQueueSeconds) start = now + leadSeconds;
	return { start, state: { next: start + durationSeconds } };
}

/** Limits keyframe production so many requests cannot make the encoder emit only keyframes. */
export function allowKeyframe(lastAtMs: number | null, nowMs: number, minIntervalMs = 500): boolean {
	return lastAtMs === null || nowMs - lastAtMs >= minIntervalMs;
}

/** Requested maximum dimensions for a screen-share resolution preset (null = source size). */
export function screenLimit(resolution: 'source' | '1080p' | '720p' | '1440p'): { w: number; h: number } | null {
	switch (resolution) {
		case '720p':
			return { w: 1280, h: 720 };
		case '1080p':
			return { w: 1920, h: 1080 };
		case '1440p':
			return { w: 2560, h: 1440 };
		default:
			return null;
	}
}

/** Fits (w,h) inside the limit keeping the aspect ratio, rounded down to even numbers as H.264 requires. */
export function fitEven(w: number, h: number, limit: { w: number; h: number } | null): { w: number; h: number } {
	let s = 1;
	if (limit) s = Math.min(1, limit.w / w, limit.h / h);
	const even = (n: number) => Math.max(2, Math.floor((n * s) / 2) * 2);
	return { w: even(w), h: even(h) };
}
