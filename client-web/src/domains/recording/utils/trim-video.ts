/**
 * Cuts a recorded video to `[start, end]` seconds by playing that range into a
 * canvas and re-recording it (audio is taken from the element when the
 * browser can capture it). Browsers cannot cut a WebM/MP4 blob directly.
 *
 * @param video - A loaded `<video>` element playing the recording.
 * @param start - Range start in seconds.
 * @param end - Range end in seconds.
 * @param mimeType - Output format, normally the original blob's type.
 * @param fallback - Returned if no 2D canvas context is available.
 */
export function trimVideoBlob(
	video: HTMLVideoElement,
	start: number,
	end: number,
	mimeType: string,
	fallback: Blob,
): Promise<Blob> {
	return new Promise((resolve) => {
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth || 480;
		canvas.height = video.videoHeight || 480;
		const ctx = canvas.getContext('2d');
		if (!ctx) return resolve(fallback);

		const stream = canvas.captureStream(30);

		// Add the audio track if the browser can capture it from the element.
		try {
			const media = video as HTMLVideoElement & {
				captureStream?: () => MediaStream;
				mozCaptureStream?: () => MediaStream;
			};
			const audioStream = media.captureStream?.() || media.mozCaptureStream?.();
			const audioTracks = audioStream?.getAudioTracks() ?? [];
			if (audioTracks.length > 0) stream.addTrack(audioTracks[0]);
		} catch {
			// capturing audio is best-effort; the trimmed clip is then silent
		}

		const chunks: Blob[] = [];
		const recorder = new MediaRecorder(stream, { mimeType });
		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
		recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));

		video.currentTime = start;
		video.onseeked = () => {
			video.onseeked = null;
			recorder.start();

			let animId = 0;
			const draw = () => {
				if (video.currentTime >= end || video.paused || video.ended) {
					cancelAnimationFrame(animId);
					if (recorder.state === 'recording') recorder.stop();
					return;
				}
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				animId = requestAnimationFrame(draw);
			};

			video.play().then(draw);
		};
	});
}
