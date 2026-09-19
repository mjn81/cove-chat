/**
 * VoicePlayerStore — uses AudioContext + AudioBufferSourceNode instead of
 * HTMLAudioElement so MediaRecorder WebM files are always seekable.
 */

import { db } from '@/lib/db';
import { apiGetFile } from '@/api/client';
import { decryptAndDecompressFile } from '@/utils/file';
import { base64ToBytes, getChannelKey } from '@/ws';

export interface VoiceTrack {
	fileId: string;
	channelId: string;
	mime: string;
	nonce: string;
	waveform: number[] | null;
	label?: string;
}

export type RepeatMode = 'none' | 'once' | 'all';

export interface VoicePlayerState {
	track: VoiceTrack | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	speed: number;
	volume: number;
	repeatMode: RepeatMode;
}

type Listener = (state: VoicePlayerState) => void;
export const SPEEDS = [1, 1.5, 2, 2.5, 3];

/**
 * Encodes an AudioBuffer into a WAV Blob.
 * This is used because HTMLAudioElement supports pitch-preserved playback
 * (preservesPitch = true) and seeking in WAV is 100% reliable compared to WebM.
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const format = 1; // PCM
	const bitDepth = 16;

	const bytesPerSample = bitDepth / 8;
	const blockAlign = numChannels * bytesPerSample;

	const bufferLength = buffer.length * blockAlign;
	const headerLength = 44;
	const totalLength = headerLength + bufferLength;

	const arrayBuffer = new ArrayBuffer(totalLength);
	const view = new DataView(arrayBuffer);

	const writeString = (offset: number, string: string) => {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	};

	/* RIFF identifier */
	writeString(0, 'RIFF');
	/* file length */
	view.setUint32(4, 36 + bufferLength, true);
	/* RIFF type */
	writeString(8, 'WAVE');
	/* format chunk identifier */
	writeString(12, 'fmt ');
	/* format chunk length */
	view.setUint32(16, 16, true);
	/* sample format (raw) */
	view.setUint16(20, format, true);
	/* channel count */
	view.setUint16(22, numChannels, true);
	/* sample rate */
	view.setUint32(24, sampleRate, true);
	/* byte rate (sample rate * block align) */
	view.setUint32(28, sampleRate * blockAlign, true);
	/* block align (channel count * bytes per sample) */
	view.setUint16(32, blockAlign, true);
	/* bits per sample */
	view.setUint16(34, bitDepth, true);
	/* data chunk identifier */
	writeString(36, 'data');
	/* data chunk length */
	view.setUint32(40, bufferLength, true);

	// Write interleaved samples
	const offset = 44;
	const channels = [];
	for (let i = 0; i < numChannels; i++) {
		channels.push(buffer.getChannelData(i));
	}

	let index = 0;
	for (let i = 0; i < buffer.length; i++) {
		for (let channel = 0; channel < numChannels; channel++) {
			let sample = channels[channel][i];
			// Clamp
			sample = Math.max(-1, Math.min(1, sample));
			// Convert to 16-bit PCM
			sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
			view.setInt16(offset + index, sample, true);
			index += 2;
		}
	}

	return new Blob([arrayBuffer], { type: 'audio/wav' });
}

class VoicePlayerStore {
	private listeners = new Set<Listener>();
	private buffers = new Map<string, AudioBuffer>(); // fileId → decoded buffer
	private wavUrls = new Map<string, string>();     // fileId → WAV object URL

	private audio: HTMLAudioElement;
	private raf: number | null = null;

	state: VoicePlayerState = {
		track: null, isPlaying: false, isLoading: false,
		currentTime: 0, duration: 0, speed: 1, volume: 1,
		repeatMode: 'none',
	};

	// ─── Store plumbing ─────────────────────────────────────────────────────
	subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
	private emit()                               { this.listeners.forEach(fn => fn({ ...this.state })); }
	private patch(p: Partial<VoicePlayerState>) { this.state = { ...this.state, ...p }; this.emit(); }

	constructor() {
		this.audio = new Audio();
		this.audio.preservesPitch = true; // Essential for speedup without chipmunk effect

		this.audio.onplay = () => {
			this.patch({ isPlaying: true });
			this.startRaf();
		};
		this.audio.onpause = () => {
			this.stopRaf();
			this.patch({ isPlaying: false, currentTime: this.audio.currentTime });
		};
		this.audio.onended = () => {
			if (this.state.repeatMode === 'all') {
				this.audio.currentTime = 0;
				this.audio.play().catch(console.error);
				this.patch({ currentTime: 0, isPlaying: true });
			} else if (this.state.repeatMode === 'once') {
				this.patch({ repeatMode: 'none', currentTime: 0, isPlaying: true });
				this.audio.currentTime = 0;
				this.audio.play().catch(console.error);
			} else {
				this.stopRaf();
				this.patch({ isPlaying: false, currentTime: 0 });
			}
		};
		this.audio.onratechange = () => {
			// Ensure UI is in sync if speed changed via native controls
			this.patch({ speed: this.audio.playbackRate });
		};
		this.audio.onvolumechange = () => {
			this.patch({ volume: this.audio.volume });
		};
	}

	// ─── AudioContext helpers ────────────────────────────────────────────────
	private getCtx(): AudioContext {
		return new AudioContext();
	}

	private startRaf() {
		const tick = () => {
			if (!this.audio.paused && !this.audio.ended) {
				this.patch({ currentTime: this.audio.currentTime });
				this.raf = requestAnimationFrame(tick);
			}
		};
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = requestAnimationFrame(tick);
	}

	private stopRaf() {
		if (this.raf) {
			cancelAnimationFrame(this.raf);
			this.raf = null;
		}
	}

	// ─── Fetch / decode ──────────────────────────────────────────────────────
	private async fetchAndDecode(track: VoiceTrack): Promise<string> {
		const cachedUrl = this.wavUrls.get(track.fileId);
		if (cachedUrl) return cachedUrl;

		let data: Uint8Array;
		const dbCached = await db.getCachedFile(track.fileId);
		if (dbCached) {
			data = dbCached.data;
		} else {
			const key = getChannelKey(track.channelId);
			if (!key) throw new Error('Missing channel key');
			const enc = await apiGetFile(track.fileId);
			data = await decryptAndDecompressFile(
				new Uint8Array(enc), base64ToBytes(track.nonce), key, true,
			);
			await db.cacheFile(track.fileId, data, track.mime);
		}

		// Use AudioContext ONLY for decoding (fixes WebM duration/metadata bugs)
		const ctx = this.getCtx();
		const buffer = await ctx.decodeAudioData(data.slice(0).buffer);
		ctx.close();

		// Convert to WAV for perfect seeking + native pitch preservation
		const wavBlob = audioBufferToWav(buffer);
		const url = URL.createObjectURL(wavBlob);
		this.wavUrls.set(track.fileId, url);
		this.buffers.set(track.fileId, buffer); // Keep buffer for waveform if needed
		return url;
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	async play(track: VoiceTrack) {
		// Resume same track
		if (this.state.track?.fileId === track.fileId && this.audio.src) {
			this.audio.playbackRate = this.state.speed;
			await this.audio.play();
			return;
		}

		this.patch({ track, isLoading: true, isPlaying: false, currentTime: 0, duration: 0 });

		try {
			const url = await this.fetchAndDecode(track);
			this.audio.src = url;
			this.audio.playbackRate = this.state.speed;
			
			// Load and wait for enough data
			await new Promise<void>((resolve) => {
				if (this.audio.readyState >= 2) {
					resolve();
					return;
				}
				const onReady = () => {
					cleanup();
					resolve();
				};
				const cleanup = () => {
					this.audio.removeEventListener('canplay', onReady);
					this.audio.removeEventListener('loadeddata', onReady);
					this.audio.removeEventListener('error', onReady);
				};
				this.audio.addEventListener('canplay', onReady);
				this.audio.addEventListener('loadeddata', onReady);
				this.audio.addEventListener('error', onReady);
				this.audio.load();
			});

			this.patch({
				duration: this.audio.duration,
				isLoading: false,
			});
			await this.audio.play();
		} catch (err) {
			console.error('[VoicePlayer] play error:', err);
			this.patch({ isLoading: false, isPlaying: false });
		}
	}

	pause() {
		this.audio.pause();
	}

	togglePlay() {
		if (!this.audio.paused) this.pause();
		else if (this.state.track) this.play(this.state.track);
	}

	seek(percent: number) {
		const dur = this.audio.duration;
		if (!isFinite(dur) || dur <= 0) return;
		const t = Math.max(0, Math.min(1, percent)) * dur;
		this.audio.currentTime = t;
		this.patch({ currentTime: t });
	}

	cycleSpeed() {
		const idx = SPEEDS.indexOf(this.state.speed);
		const next = SPEEDS[(idx + 1) % SPEEDS.length];
		this.setSpeed(next);
	}

	setSpeed(speed: number) {
		const s = Math.max(0.5, Math.min(4, speed));
		this.audio.playbackRate = s;
		this.patch({ speed: s });
	}

	setVolume(volume: number) {
		const v = Math.max(0, Math.min(1, volume));
		this.audio.volume = v;
		this.patch({ volume: v });
	}

	cycleRepeat() {
		const order: RepeatMode[] = ['none', 'once', 'all'];
		const next = order[(order.indexOf(this.state.repeatMode) + 1) % order.length];
		this.setRepeatMode(next);
	}

	setRepeatMode(mode: RepeatMode) {
		this.audio.loop = mode === 'all';
		this.patch({ repeatMode: mode });
	}

	close() {
		this.audio.pause();
		this.audio.src = '';
		this.stopRaf();
		this.patch({ track: null, isPlaying: false, currentTime: 0, duration: 0 });
	}

	progressFor(fileId: string): number {
		if (this.state.track?.fileId !== fileId) return 0;
		const { currentTime, duration } = this.state;
		return duration > 0 ? currentTime / duration : 0;
	}
}

export const voicePlayer = new VoicePlayerStore();
