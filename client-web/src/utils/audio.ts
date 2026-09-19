/**
 * Audio decoding, waveform extraction, trimming, and WAV encoding utilities.
 */

/**
 * Decodes an audio Blob into an AudioBuffer using the browser's Web Audio API.
 */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
	const arrayBuffer = await blob.arrayBuffer();
	const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
	const audioCtx = new AudioCtxClass();
	try {
		return await audioCtx.decodeAudioData(arrayBuffer);
	} finally {
		if (audioCtx.state !== 'closed') {
			audioCtx.close().catch(() => {});
		}
	}
}

/**
 * Extracts a normalized waveform peak array (e.g. 28-40 bars, values 10-100) from an AudioBuffer.
 */
export function extractWaveformPeaks(buffer: AudioBuffer, numPeaks = 32): number[] {
	const channelData = buffer.getChannelData(0);
	const step = Math.floor(channelData.length / numPeaks);
	const peaks: number[] = [];

	for (let i = 0; i < numPeaks; i++) {
		const start = i * step;
		const end = Math.min(start + step, channelData.length);
		let max = 0;
		for (let j = start; j < end; j++) {
			const abs = Math.abs(channelData[j]);
			if (abs > max) max = abs;
		}
		// Scale to 15-100 percentage for visible aesthetics
		const scaled = Math.round(Math.min(1, max * 1.6) * 85) + 15;
		peaks.push(scaled);
	}
	return peaks;
}

/**
 * Trims an AudioBuffer between startTime and endTime (in seconds).
 */
export function sliceAudioBuffer(
	buffer: AudioBuffer,
	startTime: number,
	endTime: number,
): AudioBuffer {
	const sampleRate = buffer.sampleRate;
	const startOffset = Math.max(0, Math.floor(startTime * sampleRate));
	const endOffset = Math.min(buffer.length, Math.floor(endTime * sampleRate));
	const frameCount = Math.max(1, endOffset - startOffset);

	const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
	const audioCtx = new AudioCtxClass();
	const trimmed = audioCtx.createBuffer(
		buffer.numberOfChannels,
		frameCount,
		sampleRate,
	);
	audioCtx.close().catch(() => {});

	for (let c = 0; c < buffer.numberOfChannels; c++) {
		const sourceData = buffer.getChannelData(c);
		const targetData = trimmed.getChannelData(c);
		targetData.set(sourceData.subarray(startOffset, endOffset));
	}

	return trimmed;
}

/**
 * Encodes an AudioBuffer into a 16-bit PCM WAV Blob.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const format = 1; // PCM
	const bitDepth = 16;
	const bytesPerSample = bitDepth / 8;
	const blockAlign = numChannels * bytesPerSample;

	const numFrames = buffer.length;
	const byteRate = sampleRate * blockAlign;
	const dataSize = numFrames * blockAlign;
	const bufferSize = 44 + dataSize;

	const arrayBuffer = new ArrayBuffer(bufferSize);
	const view = new DataView(arrayBuffer);

	// RIFF header
	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, 'WAVE');

	// "fmt " subchunk
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, format, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitDepth, true);

	// "data" subchunk
	writeString(view, 36, 'data');
	view.setUint32(40, dataSize, true);

	// Write interleaved samples
	const channels: Float32Array[] = [];
	for (let i = 0; i < numChannels; i++) {
		channels.push(buffer.getChannelData(i));
	}

	let offset = 44;
	for (let i = 0; i < numFrames; i++) {
		for (let c = 0; c < numChannels; c++) {
			const sample = Math.max(-1, Math.min(1, channels[c][i]));
			const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
			view.setInt16(offset, int16, true);
			offset += 2;
		}
	}

	return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
