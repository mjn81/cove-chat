/** A one-shot timer that can be paused (the pointer is over a popup) and resumed with the time it had left. */
export class PauseTimer {
	private readonly onDone: () => void;
	private remaining: number;
	private startedAt = 0;
	private handle: ReturnType<typeof setTimeout> | null = null;

	/**
	 * @param ms - how long until `onDone` fires, counting only running time.
	 * @param onDone - called once when the time is up.
	 */
	constructor(ms: number, onDone: () => void) {
		this.remaining = ms;
		this.onDone = onDone;
	}

	/** Starts or resumes the countdown. */
	start(): void {
		if (this.handle !== null) return;
		this.startedAt = Date.now();
		this.handle = setTimeout(() => {
			this.handle = null;
			this.remaining = 0;
			this.onDone();
		}, this.remaining);
	}

	/** Stops the countdown, remembering how much time is left. */
	pause(): void {
		if (this.handle === null) return;
		clearTimeout(this.handle);
		this.handle = null;
		this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
	}

	/** Stops the countdown for good. */
	cancel(): void {
		if (this.handle !== null) clearTimeout(this.handle);
		this.handle = null;
	}
}
