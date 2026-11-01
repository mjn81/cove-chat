/** The slice of `HTMLAudioElement` the ringer uses, so tests can pass a fake. */
export interface RingerAudio {
	src: string;
	loop: boolean;
	volume: number;
	currentTime: number;
	play: () => Promise<void>;
	pause: () => void;
}

/** An unanswered call stops ringing after this long. */
export const RING_LIMIT_MS = 30_000;

/**
 * A looping ringtone with one rule: only one ring at a time. It stops by itself after a limit, and quietly gives up
 * when the browser blocks autoplay (nothing has been clicked on the page yet), so the native notification and the
 * on-screen card still tell the user about the call.
 *
 * @param createAudio - Builds an audio element for a source (defaults to `new Audio` at the call site).
 * @param limitMs - How long to ring when nobody answers.
 */
export function createRinger(createAudio: (src: string) => RingerAudio, limitMs: number = RING_LIMIT_MS) {
	let current: RingerAudio | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const stop = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		if (current) {
			current.pause();
			current.currentTime = 0;
		}
		current = null;
	};

	return {
		/** Starts ringing `src` unless a ring is already going. */
		start(src: string, volume = 0.6) {
			if (current) return;
			const audio = createAudio(src);
			audio.loop = true;
			audio.volume = volume;
			current = audio;
			audio.play().catch(() => {
				// Autoplay was blocked: stop tracking this ring so a later call can try again.
				if (current === audio) stop();
			});
			timer = setTimeout(stop, limitMs);
		},
		stop,
		isRinging: () => current !== null,
	};
}

/** The app's single ringer, used for incoming calls. */
export const callRinger = createRinger((src) => new Audio(src));
