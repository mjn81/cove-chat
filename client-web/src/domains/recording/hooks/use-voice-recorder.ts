import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	audioBufferToWav,
	decodeAudioBlob,
	extractWaveformPeaks,
	sliceAudioBuffer,
} from '@/utils/audio';
import { logger } from '@/utils/logger';
import {
	LIVE_BAR_COUNT,
	computeLiveLevels,
	pickRecorderMimeType,
	voiceFileMeta,
} from '../utils/recording';
import { clampTrimEnd, clampTrimStart, isTrimmed, pointerToSeconds } from '@/utils/trim';

/** Recorder phases: nothing happening, capturing, or reviewing/trimming the take. */
export type RecorderMode = 'idle' | 'recording' | 'preview';

interface UseVoiceRecorderArgs {
	/** Receives the file when there is no direct-send handler (it is queued as an attachment). */
	onFile: (file: File) => void;
	/** Sends the finished voice note straight away. */
	onSendVoice?: (file: File, duration?: number) => Promise<void>;
}

type WailsWindow = Window & {
	go?: { main?: { App?: { RequestMicrophonePermission?: () => Promise<void> } } };
	webkitAudioContext?: typeof AudioContext;
};

/**
 * The voice-note state machine: record with a live level meter, pause to
 * review, trim with two draggable handles, then send (or quick-send while
 * still recording). Owns the MediaRecorder, AudioContext and preview player
 * and releases all of them on unmount.
 */
export function useVoiceRecorder({ onFile, onSendVoice }: UseVoiceRecorderArgs) {
	const { t } = useTranslation();
	const [mode, setMode] = useState<RecorderMode>('idle');
	const [duration, setDuration] = useState(0);
	const [isSending, setIsSending] = useState(false);
	const [liveLevels, setLiveLevels] = useState<number[]>(() => Array.from({ length: LIVE_BAR_COUNT }, () => 15));

	// Preview & trimming
	const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
	const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
	const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
	const [trimStart, setTrimStart] = useState(0);
	const [trimEnd, setTrimEnd] = useState(0);
	const [isPlayingPreview, setIsPlayingPreview] = useState(false);
	const [previewCurrentTime, setPreviewCurrentTime] = useState(0);

	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const isDiscardingRef = useRef(false);
	const isQuickSendingRef = useRef(false);
	const previewAudioRef = useRef<HTMLAudioElement | null>(null);
	const previewUrlRef = useRef<string | null>(null);
	const timelineRef = useRef<HTMLDivElement | null>(null);
	const draggingHandleRef = useRef<'start' | 'end' | null>(null);
	// The preview player's callbacks outlive renders, so they read the trim range through refs.
	const trimStartRef = useRef(trimStart);
	const trimEndRef = useRef(trimEnd);
	useEffect(() => {
		trimStartRef.current = trimStart;
		trimEndRef.current = trimEnd;
	}, [trimStart, trimEnd]);

	/** Stops timers, the analyser, the audio context and the microphone stream. */
	const cleanupRecordingResources = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
		if (analyserRef.current) {
			analyserRef.current.disconnect();
			analyserRef.current = null;
		}
		if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
			audioContextRef.current.close().catch(() => {});
			audioContextRef.current = null;
		}
		if (mediaStreamRef.current) {
			mediaStreamRef.current.getTracks().forEach((track) => track.stop());
			mediaStreamRef.current = null;
		}
	}, []);

	/** Releases the preview audio element and its object URL. */
	const cleanupPreviewResources = useCallback(() => {
		if (previewAudioRef.current) {
			previewAudioRef.current.pause();
			previewAudioRef.current.src = '';
			previewAudioRef.current = null;
		}
		if (previewUrlRef.current) {
			URL.revokeObjectURL(previewUrlRef.current);
			previewUrlRef.current = null;
		}
		setIsPlayingPreview(false);
		setPreviewCurrentTime(0);
	}, []);

	useEffect(
		() => () => {
			cleanupRecordingResources();
			cleanupPreviewResources();
		},
		[cleanupRecordingResources, cleanupPreviewResources],
	);

	const startVisualizerLoop = useCallback(() => {
		const update = () => {
			const analyser = analyserRef.current;
			if (!analyser) return;
			const data = new Uint8Array(analyser.frequencyBinCount);
			analyser.getByteFrequencyData(data);
			setLiveLevels(computeLiveLevels(data));
			animationFrameRef.current = requestAnimationFrame(update);
		};
		animationFrameRef.current = requestAnimationFrame(update);
	}, []);

	const discard = useCallback(() => {
		isDiscardingRef.current = true;
		isQuickSendingRef.current = false;
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
			mediaRecorderRef.current.stop();
		}
		cleanupRecordingResources();
		cleanupPreviewResources();
		setRecordedBlob(null);
		setAudioBuffer(null);
		setMode('idle');
		setDuration(0);
	}, [cleanupRecordingResources, cleanupPreviewResources]);

	/**
	 * Exports (trimming to WAV if needed) and hands the note to `onSendVoice`
	 * or `onFile`. The defaults send the whole preview with the current trim.
	 */
	const send = async (
		blobToSend?: Blob,
		tStart = trimStart,
		tEnd = trimEnd,
		exactDuration?: number,
		buf?: AudioBuffer | null,
	) => {
		setIsSending(true);
		try {
			const buffer = buf || audioBuffer;
			let output = blobToSend || recordedBlob;
			let finalDuration = exactDuration || (buffer ? buffer.duration : duration);

			if (buffer && isTrimmed(buffer.duration, tStart, tEnd)) {
				const sliced = sliceAudioBuffer(buffer, tStart, tEnd);
				output = audioBufferToWav(sliced);
				finalDuration = sliced.duration;
			}
			if (!output || output.size === 0) return;

			const meta = voiceFileMeta(output.type, Date.now());
			const file = new File([output], meta.name, { type: meta.type });
			if (onSendVoice) await onSendVoice(file, finalDuration);
			else onFile(file);

			discard();
		} catch (err) {
			logger.error('Failed to send voice message', { error: String(err) });
		} finally {
			setIsSending(false);
		}
	};

	const start = async () => {
		try {
			cleanupRecordingResources();
			cleanupPreviewResources();

			// On macOS Wails, request mic permission via the native backend if available.
			const wails = (window as WailsWindow).go?.main?.App;
			if (wails?.RequestMicrophonePermission) await wails.RequestMicrophonePermission();

			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error('Your browser environment does not support microphone access.');
			}

			const preferredMicId = localStorage.getItem('preferred-mic-id');
			const stream = await navigator.mediaDevices.getUserMedia({
				audio:
					preferredMicId && preferredMicId !== 'default' ? { deviceId: { exact: preferredMicId } } : true,
			});
			mediaStreamRef.current = stream;

			const AudioCtx = window.AudioContext || (window as WailsWindow).webkitAudioContext!;
			const audioCtx = new AudioCtx();
			audioContextRef.current = audioCtx;
			const analyser = audioCtx.createAnalyser();
			analyser.fftSize = 64; // 32 frequency bins
			analyser.smoothingTimeConstant = 0.65;
			audioCtx.createMediaStreamSource(stream).connect(analyser);
			analyserRef.current = analyser;

			const mimeType = pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined,
			);
			mediaRecorderRef.current = recorder;
			chunksRef.current = [];
			isDiscardingRef.current = false;

			recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
			};

			recorder.onstop = async () => {
				cleanupRecordingResources();

				if (isDiscardingRef.current) {
					chunksRef.current = [];
					setMode('idle');
					return;
				}

				const rawBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm;codecs=opus' });
				if (rawBlob.size === 0) {
					setMode('idle');
					return;
				}

				let decoded: AudioBuffer | null = null;
				let exactDuration = duration;
				try {
					decoded = await decodeAudioBlob(rawBlob);
					exactDuration = decoded.duration;
				} catch (decErr) {
					logger.warn('Could not decode audio buffer for duration', { error: String(decErr) });
				}

				// Quick send while recording: ship the native Opus blob without a preview step.
				if (isQuickSendingRef.current) {
					isQuickSendingRef.current = false;
					await send(rawBlob, 0, exactDuration, exactDuration, decoded);
					return;
				}

				setRecordedBlob(rawBlob);
				setAudioBuffer(decoded);
				setWaveformPeaks(decoded ? extractWaveformPeaks(decoded, 36) : []);
				setTrimStart(0);
				setTrimEnd(exactDuration);
				setDuration(exactDuration);

				const audioUrl = URL.createObjectURL(rawBlob);
				previewUrlRef.current = audioUrl;
				const audio = new Audio(audioUrl);
				previewAudioRef.current = audio;
				audio.ontimeupdate = () => {
					setPreviewCurrentTime(audio.currentTime);
					if (audio.currentTime >= (trimEndRef.current || exactDuration)) {
						audio.pause();
						audio.currentTime = trimStartRef.current;
						setIsPlayingPreview(false);
					}
				};
				audio.onended = () => {
					setIsPlayingPreview(false);
					audio.currentTime = trimStartRef.current;
				};

				setMode('preview');
			};

			recorder.start(250); // collect data chunks every 250 ms
			setMode('recording');
			setDuration(0);
			startVisualizerLoop();
			timerRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
		} catch (err) {
			logger.error('Failed to start voice recording', { error: String(err) });
			toast.error(
				t('errors.microphone', { message: err instanceof Error ? err.message : t('errors.unknown') }),
			);
			setMode('idle');
			cleanupRecordingResources();
		}
	};

	/** Stops recording and opens the review/trim view. */
	const pauseAndReview = () => {
		if (mediaRecorderRef.current && mode === 'recording') {
			isDiscardingRef.current = false;
			isQuickSendingRef.current = false;
			mediaRecorderRef.current.stop();
		}
	};

	/** Stops recording and sends immediately, skipping the review step. */
	const quickSend = () => {
		const recorder = mediaRecorderRef.current;
		if (recorder && recorder.state !== 'inactive') {
			isDiscardingRef.current = false;
			isQuickSendingRef.current = true;
			recorder.stop();
		}
	};

	const togglePreviewPlay = () => {
		const audio = previewAudioRef.current;
		if (!audio) return;
		if (isPlayingPreview) {
			audio.pause();
			setIsPlayingPreview(false);
			return;
		}
		if (audio.currentTime < trimStart || audio.currentTime >= trimEnd) audio.currentTime = trimStart;
		audio
			.play()
			.then(() => setIsPlayingPreview(true))
			.catch((e) => logger.error('Audio preview play error', { error: String(e) }));
	};

	const resetTrim = () => {
		if (!audioBuffer) return;
		setTrimStart(0);
		setTrimEnd(audioBuffer.duration);
		if (previewAudioRef.current) previewAudioRef.current.currentTime = 0;
	};

	const beginDrag = (handle: 'start' | 'end', e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		draggingHandleRef.current = handle;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: React.PointerEvent) => {
		const handle = draggingHandleRef.current;
		if (!handle || !timelineRef.current || !audioBuffer) return;
		const target = pointerToSeconds(e.clientX, timelineRef.current.getBoundingClientRect(), audioBuffer.duration);

		if (handle === 'start') {
			const next = clampTrimStart(target, trimEnd);
			setTrimStart(next);
			if (previewAudioRef.current) previewAudioRef.current.currentTime = next;
		} else {
			setTrimEnd(clampTrimEnd(target, trimStart, audioBuffer.duration));
		}
	};

	const onPointerUp = (e: React.PointerEvent) => {
		if (!draggingHandleRef.current) return;
		try {
			(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// pointer capture already released
		}
		draggingHandleRef.current = null;
	};

	/** Click on the timeline: seek the preview, kept inside the trimmed range. */
	const seekTo = (clientX: number) => {
		if (!timelineRef.current || !previewAudioRef.current) return;
		const total = audioBuffer?.duration || duration || 1;
		const seconds = pointerToSeconds(clientX, timelineRef.current.getBoundingClientRect(), total);
		const clamped = Math.max(trimStart, Math.min(trimEnd, seconds));
		previewAudioRef.current.currentTime = clamped;
		setPreviewCurrentTime(clamped);
	};

	return {
		mode,
		duration,
		isSending,
		liveLevels,
		waveformPeaks,
		totalDuration: audioBuffer?.duration || duration || 1,
		trimStart,
		trimEnd,
		isPlayingPreview,
		previewCurrentTime,
		timelineRef,
		start,
		pauseAndReview,
		quickSend,
		discard,
		send: () => send(),
		togglePreviewPlay,
		resetTrim,
		beginDrag,
		onPointerMove,
		onPointerUp,
		seekTo,
	};
}
