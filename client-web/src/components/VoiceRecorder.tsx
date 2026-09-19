import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Mic,
	Trash2,
	Send,
	Pause,
	Play,
	RotateCcw,
	Loader2,
	Scissors,
} from 'lucide-react';
import {
	decodeAudioBlob,
	extractWaveformPeaks,
	sliceAudioBuffer,
	audioBufferToWav,
} from '@/utils/audio';

interface VoiceRecorderProps {
	channelId: string;
	onFile: (file: File) => void;
	onSendVoice?: (file: File, duration?: number) => Promise<void>;
	size?: number;
}

type StudioMode = 'idle' | 'recording' | 'preview';

export default function VoiceRecorder({
	onFile,
	onSendVoice,
	size = 20,
}: VoiceRecorderProps) {
	const { t } = useTranslation();
	const [mode, setMode] = useState<StudioMode>('idle');
	const [duration, setDuration] = useState(0);
	const [isSending, setIsSending] = useState(false);

	// Real-time live audio levels (28 bars)
	const [liveLevels, setLiveLevels] = useState<number[]>(() =>
		Array.from({ length: 28 }, () => 15),
	);

	// Preview & Trimming state
	const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
	const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
	const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
	const [trimStart, setTrimStart] = useState(0);
	const [trimEnd, setTrimEnd] = useState(0);
	const [isPlayingPreview, setIsPlayingPreview] = useState(false);
	const [previewCurrentTime, setPreviewCurrentTime] = useState(0);

	// Refs
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

	// Clean up AudioContext, streams, and timers
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

	// Clean up preview audio element and object URL
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

	// Unmount cleanup
	useEffect(() => {
		return () => {
			cleanupRecordingResources();
			cleanupPreviewResources();
		};
	}, [cleanupRecordingResources, cleanupPreviewResources]);

	// Live audio visualizer loop
	const startVisualizerLoop = useCallback(() => {
		const updateLevels = () => {
			if (!analyserRef.current) return;

			const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
			analyserRef.current.getByteFrequencyData(dataArray);

			// Map frequency spectrum to 28 visualizer bars
			const barCount = 28;
			const step = Math.floor(dataArray.length / barCount);
			const newLevels: number[] = [];

			for (let i = 0; i < barCount; i++) {
				const start = i * step;
				let sum = 0;
				for (let j = 0; j < step; j++) {
					sum += dataArray[start + j] || 0;
				}
				const avg = sum / (step || 1);
				// Scale to percentage: minimum 14% height, up to 100%
				const heightPercent = Math.min(
					100,
					Math.max(14, Math.round((avg / 255) * 115)),
				);
				newLevels.push(heightPercent);
			}

			setLiveLevels(newLevels);
			animationFrameRef.current = requestAnimationFrame(updateLevels);
		};

		animationFrameRef.current = requestAnimationFrame(updateLevels);
	}, []);

	// ── 1. Start Recording ─────────────────────────────────────────────────────
	const startRecording = async () => {
		try {
			cleanupRecordingResources();
			cleanupPreviewResources();

			// On macOS Wails, request mic permission via native backend if available
			const wails = (window as any).go?.main?.App;
			if (wails?.RequestMicrophonePermission) {
				await wails.RequestMicrophonePermission();
			}

			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
				throw new Error(
					'Your browser environment does not support microphone access.',
				);
			}

			const preferredMicId = localStorage.getItem('preferred-mic-id');
			const constraints: MediaStreamConstraints = {
				audio:
					preferredMicId && preferredMicId !== 'default'
						? { deviceId: { exact: preferredMicId } }
						: true,
			};

			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			mediaStreamRef.current = stream;

			// Setup Web Audio Analyser
			const AudioCtxClass =
				window.AudioContext || (window as any).webkitAudioContext;
			const audioCtx = new AudioCtxClass();
			audioContextRef.current = audioCtx;

			const source = audioCtx.createMediaStreamSource(stream);
			const analyser = audioCtx.createAnalyser();
			analyser.fftSize = 64; // 32 frequency bins
			analyser.smoothingTimeConstant = 0.65;
			source.connect(analyser);
			analyserRef.current = analyser;

			// Setup MediaRecorder with Opus compression prioritized
			const mimeType = [
				'audio/webm;codecs=opus',
				'audio/ogg;codecs=opus',
				'audio/webm',
				'audio/ogg',
				'audio/mp4',
			].find((type) => MediaRecorder.isTypeSupported(type));
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined,
			);
			mediaRecorderRef.current = recorder;
			chunksRef.current = [];
			isDiscardingRef.current = false;

			recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) {
					chunksRef.current.push(e.data);
				}
			};

			recorder.onstop = async () => {
				cleanupRecordingResources();

				if (isDiscardingRef.current) {
					chunksRef.current = [];
					setMode('idle');
					return;
				}

				// Recording finished: package into compact Opus Blob
				const recorderMime = recorder.mimeType || 'audio/webm;codecs=opus';
				const rawBlob = new Blob(chunksRef.current, { type: recorderMime });
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
					console.warn('Could not decode audio buffer for duration:', decErr);
				}

				// If quick send was triggered while recording, send native Opus blob immediately
				if (isQuickSendingRef.current) {
					isQuickSendingRef.current = false;
					await handleFinalSend(
						rawBlob,
						0,
						exactDuration,
						exactDuration,
						decoded,
					);
					return;
				}

				// Otherwise, transition to Preview & Trim studio
				setRecordedBlob(rawBlob);
				setAudioBuffer(decoded);
				const peaks = decoded ? extractWaveformPeaks(decoded, 36) : [];
				setWaveformPeaks(peaks);
				setTrimStart(0);
				setTrimEnd(exactDuration);
				setDuration(exactDuration);

				// Setup Preview Audio Player
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

			recorder.start(250); // Collect data chunks every 250ms
			setMode('recording');
			setDuration(0);

			startVisualizerLoop();

			timerRef.current = setInterval(() => {
				setDuration((prev) => prev + 1);
			}, 1000);
		} catch (err: any) {
			console.error('Failed to start voice recording:', err);
			alert(
				`Microphone error: ${err.message || 'Unknown error'}. Please check permissions.`,
			);
			setMode('idle');
			cleanupRecordingResources();
		}
	};

	// ── 2. Pause & Switch to Preview Mode ──────────────────────────────────────
	const pauseAndReview = () => {
		if (mediaRecorderRef.current && mode === 'recording') {
			isDiscardingRef.current = false;
			isQuickSendingRef.current = false;
			mediaRecorderRef.current.stop();
		}
	};

	// ── 3. Discard Recording ───────────────────────────────────────────────────
	const discardRecording = () => {
		isDiscardingRef.current = true;
		isQuickSendingRef.current = false;
		if (
			mediaRecorderRef.current &&
			mediaRecorderRef.current.state !== 'inactive'
		) {
			mediaRecorderRef.current.stop();
		}
		cleanupRecordingResources();
		cleanupPreviewResources();
		setRecordedBlob(null);
		setAudioBuffer(null);
		setMode('idle');
		setDuration(0);
	};

	// ── 4. Preview Playback ────────────────────────────────────────────────────
	// Keep refs in sync for ontimeupdate closures
	const trimStartRef = useRef(trimStart);
	const trimEndRef = useRef(trimEnd);
	useEffect(() => {
		trimStartRef.current = trimStart;
		trimEndRef.current = trimEnd;
	}, [trimStart, trimEnd]);

	const togglePreviewPlay = () => {
		const audio = previewAudioRef.current;
		if (!audio) return;

		if (isPlayingPreview) {
			audio.pause();
			setIsPlayingPreview(false);
		} else {
			if (audio.currentTime < trimStart || audio.currentTime >= trimEnd) {
				audio.currentTime = trimStart;
			}
			audio
				.play()
				.then(() => setIsPlayingPreview(true))
				.catch((e) => console.error('Audio preview play error:', e));
		}
	};

	const resetTrim = () => {
		if (!audioBuffer) return;
		setTrimStart(0);
		setTrimEnd(audioBuffer.duration);
		if (previewAudioRef.current) {
			previewAudioRef.current.currentTime = 0;
		}
	};

	// ── 5. Trimming Drag Handlers ──────────────────────────────────────────────
	const handlePointerDown = (
		handle: 'start' | 'end',
		e: React.PointerEvent,
	) => {
		e.stopPropagation();
		e.preventDefault();
		draggingHandleRef.current = handle;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	};

	const handlePointerMove = (e: React.PointerEvent) => {
		if (!draggingHandleRef.current || !timelineRef.current || !audioBuffer)
			return;

		const rect = timelineRef.current.getBoundingClientRect();
		const clientX = Math.max(rect.left, Math.min(rect.right, e.clientX));
		const ratio = (clientX - rect.left) / rect.width;
		const targetSec = ratio * audioBuffer.duration;

		if (draggingHandleRef.current === 'start') {
			// Ensure start is at least 0.5s before end
			const newStart = Math.max(0, Math.min(targetSec, trimEnd - 0.5));
			setTrimStart(newStart);
			if (previewAudioRef.current) {
				previewAudioRef.current.currentTime = newStart;
			}
		} else if (draggingHandleRef.current === 'end') {
			// Ensure end is at least 0.5s after start
			const newEnd = Math.min(
				audioBuffer.duration,
				Math.max(targetSec, trimStart + 0.5),
			);
			setTrimEnd(newEnd);
		}
	};

	const handlePointerUp = (e: React.PointerEvent) => {
		if (draggingHandleRef.current) {
			try {
				(e.target as HTMLElement).releasePointerCapture(e.pointerId);
			} catch {
				// pointer capture already released
			}
			draggingHandleRef.current = null;
		}
	};

	// ── 6. Final Send Handling ─────────────────────────────────────────────────
	const handleFinalSend = async (
		blobToSend?: Blob,
		tStart = trimStart,
		tEnd = trimEnd,
		exactDuration?: number,
		buf?: AudioBuffer | null,
	) => {
		setIsSending(true);
		try {
			const targetBuffer = buf || audioBuffer;
			let outputBlob = blobToSend || recordedBlob;

			// If user trimmed the recording, slice the AudioBuffer and export to clean WAV
			const isTrimmed =
				targetBuffer && (tStart > 0.1 || targetBuffer.duration - tEnd > 0.1);

			let finalDuration =
				exactDuration || (targetBuffer ? targetBuffer.duration : duration);

			if (isTrimmed && targetBuffer) {
				const slicedBuffer = sliceAudioBuffer(targetBuffer, tStart, tEnd);
				outputBlob = audioBufferToWav(slicedBuffer);
				finalDuration = slicedBuffer.duration;
			}

			if (!outputBlob || outputBlob.size === 0) return;

			const isWav = outputBlob.type.includes('wav');
			const ext = isWav
				? 'wav'
				: outputBlob.type.includes('ogg')
					? 'ogg'
					: 'webm';
			const mime = isWav
				? 'audio/wav'
				: outputBlob.type || 'audio/webm;codecs=opus';
			const file = new File([outputBlob], `voice-note-${Date.now()}.${ext}`, {
				type: mime,
			});

			if (onSendVoice) {
				await onSendVoice(file, finalDuration);
			} else {
				onFile(file);
			}

			discardRecording();
		} catch (err) {
			console.error('Failed to send voice message:', err);
		} finally {
			setIsSending(false);
		}
	};

	const formatDuration = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	};

	// ──────────────────────────────────────────────────────────────────────────
	// RENDER: IDLE STATE
	// ──────────────────────────────────────────────────────────────────────────
	if (mode === 'idle') {
		return (
			<button
				type="button"
				onClick={startRecording}
				className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/80 rounded-full transition flex items-center justify-center cursor-pointer group"
				title={t('chat.record_voice')}
				aria-label={t('chat.record_voice')}
			>
				<Mic
					size={size}
					className="group-hover:scale-110 transition-transform"
				/>
			</button>
		);
	}

	// ──────────────────────────────────────────────────────────────────────────
	// RENDER: ACTIVE RECORDING STATE (LIVE STUDIO)
	// ──────────────────────────────────────────────────────────────────────────
	if (mode === 'recording') {
		return (
			<div className="absolute inset-0 bg-secondary rounded-lg z-30 px-3 py-1.5 flex items-center justify-between shadow-sm animate-in fade-in duration-200 border border-primary/30 select-none">
				{/* Status & Live Timer */}
				<div className="flex items-center gap-2.5 shrink-0 pl-1">
					<div className="relative flex h-3 w-3">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
						<span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-sm" />
					</div>
					<span className="text-xs font-bold text-foreground font-mono tabular-nums tracking-wide">
						{formatDuration(duration)}
					</span>
				</div>

				{/* Center: Live Reactive Waveform Visualizer (28 bars) */}
				<div className="flex items-center justify-center gap-[3px] h-7 flex-1 px-4 overflow-hidden">
					{liveLevels.map((lvl, idx) => (
						<div
							key={idx}
							className="w-1 bg-primary rounded-full transition-all duration-75 shadow-sm"
							style={{ height: `${lvl}%` }}
						/>
					))}
				</div>

				{/* Controls: Discard, Pause & Review, Quick Send */}
				<div className="flex items-center gap-1.5 shrink-0">
					<button
						type="button"
						onClick={discardRecording}
						className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition cursor-pointer"
						title={t('chat.discard_recording')}
					>
						<Trash2 size={17} />
					</button>

					<button
						type="button"
						onClick={pauseAndReview}
						className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full transition cursor-pointer flex items-center gap-1 text-xs font-semibold"
						title={t('chat.pause_recording')}
					>
						<Pause size={17} />
					</button>

					<button
						type="button"
						onClick={() => {
							if (
								mediaRecorderRef.current &&
								mediaRecorderRef.current.state !== 'inactive'
							) {
								isDiscardingRef.current = false;
								isQuickSendingRef.current = true;
								mediaRecorderRef.current.stop();
							}
						}}
						disabled={isSending}
						className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center shadow-md transition hover:scale-105 active:scale-95 cursor-pointer shrink-0"
						title={t('chat.send_voice')}
					>
						{isSending ? (
							<Loader2 size={15} className="animate-spin" />
						) : (
							<Send size={14} className="-ml-0.5" />
						)}
					</button>
				</div>
			</div>
		);
	}

	// ──────────────────────────────────────────────────────────────────────────
	// RENDER: PREVIEW & TRIM STATE (STUDIO EDITOR)
	// ──────────────────────────────────────────────────────────────────────────
	const totalDuration = audioBuffer?.duration || duration || 1;
	const trimmedDuration = Math.max(0, trimEnd - trimStart);
	const startRatio = Math.max(0, Math.min(1, trimStart / totalDuration));
	const endRatio = Math.max(0, Math.min(1, trimEnd / totalDuration));
	const playheadRatio = Math.max(
		0,
		Math.min(1, previewCurrentTime / totalDuration),
	);
	const isTrimModified = trimStart > 0.1 || totalDuration - trimEnd > 0.1;

	return (
		<div className="absolute inset-0 bg-secondary rounded-lg z-30 px-3 py-1.5 flex items-center gap-3 shadow-sm animate-in fade-in duration-200 border border-border select-none">
			{/* Play/Pause Preview Button */}
			<button
				type="button"
				onClick={togglePreviewPlay}
				className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-sm shrink-0 cursor-pointer"
				title={isPlayingPreview ? 'Pause' : 'Play Preview'}
			>
				{isPlayingPreview ? (
					<Pause size={15} fill="currentColor" />
				) : (
					<Play size={15} fill="currentColor" />
				)}
			</button>

			{/* Time Indicator */}
			<div className="flex flex-col shrink-0 text-left">
				<span className="text-xs font-bold text-foreground font-mono tabular-nums leading-none">
					{formatDuration(trimmedDuration)}
				</span>
				<span className="text-[10px] text-muted-foreground font-mono tabular-nums mt-0.5">
					{formatDuration(previewCurrentTime)}
				</span>
			</div>

			{/* Interactive Waveform with Dual Trimming Handles */}
			<div
				ref={timelineRef}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				className="relative flex-1 h-9 flex items-center px-1 cursor-pointer overflow-hidden rounded bg-background/40 border border-border/40"
				onClick={(e) => {
					// Seek preview to clicked position if within trim range
					if (!timelineRef.current || !previewAudioRef.current) return;
					const rect = timelineRef.current.getBoundingClientRect();
					const clickRatio = (e.clientX - rect.left) / rect.width;
					const seekTime = clickRatio * totalDuration;
					const clamped = Math.max(trimStart, Math.min(trimEnd, seekTime));
					previewAudioRef.current.currentTime = clamped;
					setPreviewCurrentTime(clamped);
				}}
			>
				{/* Background Dimming for Trimmed Out Left Area */}
				<div
					className="absolute top-0 bottom-0 left-0 bg-black/40 backdrop-blur-[1px] pointer-events-none z-10"
					style={{ width: `${startRatio * 100}%` }}
				/>

				{/* Active Highlighted Trim Window */}
				<div
					className="absolute top-0 bottom-0 border-y-2 border-primary/60 bg-primary/10 pointer-events-none z-10"
					style={{
						left: `${startRatio * 100}%`,
						width: `${(endRatio - startRatio) * 100}%`,
					}}
				/>

				{/* Background Dimming for Trimmed Out Right Area */}
				<div
					className="absolute top-0 bottom-0 right-0 bg-black/40 backdrop-blur-[1px] pointer-events-none z-10"
					style={{ width: `${(1 - endRatio) * 100}%` }}
				/>

				{/* Playhead Indicator */}
				<div
					className="absolute top-0 bottom-0 w-[2px] bg-foreground shadow-sm pointer-events-none z-20"
					style={{ left: `${playheadRatio * 100}%` }}
				/>

				{/* Static Waveform Bars */}
				<div className="flex items-center justify-between gap-[2px] w-full h-full px-1">
					{waveformPeaks.map((peak, idx) => {
						const barRatio = idx / waveformPeaks.length;
						const isInside = barRatio >= startRatio && barRatio <= endRatio;
						return (
							<div
								key={idx}
								className={`flex-1 rounded-full transition-colors ${
									isInside ? 'bg-primary' : 'bg-muted-foreground/30'
								}`}
								style={{ height: `${peak}%` }}
							/>
						);
					})}
				</div>

				{/* Left Trim Handle */}
				<div
					onPointerDown={(e) => handlePointerDown('start', e)}
					style={{ left: `${startRatio * 100}%` }}
					className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-30 group touch-none"
					title="Drag to trim start"
				>
					<div className="w-1.5 h-6 bg-primary rounded-full shadow group-hover:scale-110 transition-transform" />
				</div>

				{/* Right Trim Handle */}
				<div
					onPointerDown={(e) => handlePointerDown('end', e)}
					style={{ left: `${endRatio * 100}%` }}
					className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-30 group touch-none"
					title="Drag to trim end"
				>
					<div className="w-1.5 h-6 bg-primary rounded-full shadow group-hover:scale-110 transition-transform" />
				</div>
			</div>

			{/* Reset Trim Button (if modified) */}
			{isTrimModified && (
				<button
					type="button"
					onClick={resetTrim}
					className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition shrink-0 cursor-pointer"
					title={t('chat.reset_trim')}
				>
					<RotateCcw size={15} />
				</button>
			)}

			{/* Final Controls: Discard or Send */}
			<div className="flex items-center gap-1.5 shrink-0">
				<button
					type="button"
					onClick={discardRecording}
					disabled={isSending}
					className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition cursor-pointer"
					title={t('chat.discard_recording')}
				>
					<Trash2 size={17} />
				</button>

				<button
					type="button"
					onClick={() => handleFinalSend()}
					disabled={isSending}
					className="h-8 px-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 text-xs font-bold shadow-md transition hover:scale-105 active:scale-95 cursor-pointer"
					title={t('chat.send_voice')}
				>
					{isSending ? (
						<>
							<Loader2 size={13} className="animate-spin" />
							<span>Sending...</span>
						</>
					) : (
						<>
							{isTrimModified && <Scissors size={12} />}
							<span>{t('chat.send')}</span>
						</>
					)}
				</button>
			</div>
		</div>
	);
}
