import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	Square,
	Play,
	RotateCcw,
	Send,
	X,
	FlipHorizontal,
	AlertCircle,
	Loader2,
	Scissors,
} from 'lucide-react';

interface VideoMessageRecorderModalProps {
	open: boolean;
	onClose: () => void;
	onSend: (file: File) => void;
}

const MAX_RECORDING_SECONDS = 60;

export const VideoMessageRecorderModal: React.FC<VideoMessageRecorderModalProps> = ({
	open,
	onClose,
	onSend,
}) => {
	const [mode, setMode] = useState<'idle' | 'recording' | 'preview'>('idle');
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);
	const [permissionError, setPermissionError] = useState<string | null>(null);

	const [timeLeft, setTimeLeft] = useState(MAX_RECORDING_SECONDS);
	const [recordedDuration, setRecordedDuration] = useState(0);

	const [trimStart, setTrimStart] = useState(0);
	const [trimEnd, setTrimEnd] = useState(MAX_RECORDING_SECONDS);
	const [previewCurrentTime, setPreviewCurrentTime] = useState(0);

	const [previewPlaying, setPreviewPlaying] = useState(true);
	const [isTrimmingOrSending, setIsTrimmingOrSending] = useState(false);

	const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);

	const streamRef = useRef<MediaStream | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const startTimeRef = useRef<number>(0);

	const liveVideoRef = useRef<HTMLVideoElement | null>(null);
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const recordedBlobRef = useRef<Blob | null>(null);
	const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
	const timelineRef = useRef<HTMLDivElement | null>(null);
	const draggingHandleRef = useRef<'start' | 'end' | null>(null);

	// Stop all active tracks on the camera/mic stream
	const stopStream = useCallback(() => {
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		}
	}, []);

	// Start or switch camera
	const startCamera = useCallback(
		async (deviceId?: string) => {
			stopStream();
			setPermissionError(null);
			if (!navigator?.mediaDevices?.getUserMedia) {
				setHasPermission(false);
				setPermissionError(
					'Camera API is not supported in this browser or requires HTTPS / localhost.',
				);
				return;
			}
			try {
				const constraints: MediaStreamConstraints = {
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
					},
					video: {
						width: { ideal: 480 },
						height: { ideal: 480 },
						aspectRatio: { ideal: 1 },
						facingMode: deviceId ? undefined : 'user',
						deviceId: deviceId ? { exact: deviceId } : undefined,
					},
				};

				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				streamRef.current = stream;
				setHasPermission(true);

				if (liveVideoRef.current) {
					liveVideoRef.current.srcObject = stream;
					liveVideoRef.current
						.play()
						.catch((e) => console.warn('Camera play error:', e));
				}

				// Enumerate cameras
				try {
					const devices = await navigator.mediaDevices.enumerateDevices();
					const cams = devices.filter((d) => d.kind === 'videoinput');
					setVideoDevices(cams);
				} catch (_) {}
			} catch (err: any) {
				console.error('Camera access failed:', err);
				setHasPermission(false);
				setPermissionError(
					err?.message ||
						'Unable to access camera or microphone. Please check permissions.',
				);
			}
		},
		[stopStream],
	);

	// Ensure live stream is bound to video element when DOM mounts
	useEffect(() => {
		if (liveVideoRef.current && streamRef.current && mode !== 'preview') {
			liveVideoRef.current.srcObject = streamRef.current;
			liveVideoRef.current.play().catch(() => {});
		}
	}, [mode, hasPermission, open]);

	// Handle open/close lifecycle - ONLY depends on `open`
	useEffect(() => {
		if (open) {
			// Clear old state
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
			mediaRecorderRef.current = null;
			chunksRef.current = [];
			recordedBlobRef.current = null;
			setRecordedUrl(null);
			setMode('idle');
			setTimeLeft(MAX_RECORDING_SECONDS);
			setRecordedDuration(0);
			setTrimStart(0);
			setTrimEnd(MAX_RECORDING_SECONDS);
			setPreviewPlaying(true);
			setIsTrimmingOrSending(false);

			startCamera();
		} else {
			stopStream();
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
			if (
				mediaRecorderRef.current &&
				mediaRecorderRef.current.state !== 'inactive'
			) {
				try {
					mediaRecorderRef.current.stop();
				} catch (_) {}
			}
			mediaRecorderRef.current = null;
			chunksRef.current = [];
			setRecordedUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return null;
			});
			setMode('idle');
		}

		return () => {
			stopStream();
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [open, startCamera, stopStream]);

	// Switch camera if multiple cameras available
	const toggleCamera = () => {
		if (videoDevices.length <= 1) return;
		const nextIndex = (selectedDeviceIndex + 1) % videoDevices.length;
		setSelectedDeviceIndex(nextIndex);
		startCamera(videoDevices[nextIndex].deviceId);
	};

	// Start recording
	const startRecording = () => {
		if (!streamRef.current) return;
		chunksRef.current = [];

		const candidates = [
			'video/webm;codecs=vp8,opus',
			'video/webm;codecs=vp9,opus',
			'video/webm',
			'video/mp4',
		];
		const supportedType =
			candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';

		const options: MediaRecorderOptions = supportedType
			? { mimeType: supportedType }
			: {};
		const recorder = new MediaRecorder(streamRef.current, options);

		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) {
				chunksRef.current.push(e.data);
			}
		};

		recorder.onstop = () => {
			const mime = recorder.mimeType || 'video/mp4';
			const blob = new Blob(chunksRef.current, { type: mime });
			recordedBlobRef.current = blob;
			const url = URL.createObjectURL(blob);
			setRecordedUrl(url);

			const actualDuration = (Date.now() - startTimeRef.current) / 1000;
			const dur = Math.min(
				MAX_RECORDING_SECONDS,
				Math.max(1, actualDuration),
			);
			setRecordedDuration(dur);
			setTrimStart(0);
			setTrimEnd(dur);

			// Switch to preview mode and stop live stream
			setMode('preview');
			stopStream();
		};

		mediaRecorderRef.current = recorder;
		startTimeRef.current = Date.now();
		recorder.start(200);
		setMode('recording');
		setTimeLeft(MAX_RECORDING_SECONDS);

		if (timerRef.current) clearInterval(timerRef.current);
		timerRef.current = setInterval(() => {
			const elapsed = (Date.now() - startTimeRef.current) / 1000;
			const remaining = Math.max(0, MAX_RECORDING_SECONDS - elapsed);
			setTimeLeft(remaining);

			if (remaining <= 0) {
				stopRecording();
			}
		}, 100);
	};

	// Stop recording
	const stopRecording = () => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (
			mediaRecorderRef.current &&
			mediaRecorderRef.current.state === 'recording'
		) {
			try {
				mediaRecorderRef.current.stop();
			} catch (e) {
				console.error('Stop recorder error:', e);
			}
		}
	};

	// Retake recording
	const handleRetake = () => {
		if (recordedUrl) {
			URL.revokeObjectURL(recordedUrl);
			setRecordedUrl(null);
		}
		recordedBlobRef.current = null;
		setMode('idle');
		setTimeLeft(MAX_RECORDING_SECONDS);
		setRecordedDuration(0);
		setTrimStart(0);
		setTrimEnd(MAX_RECORDING_SECONDS);
		setPreviewPlaying(true);
		setIsTrimmingOrSending(false);

		startCamera();
	};

	// Keep preview looping within trimStart and trimEnd
	const handlePreviewTimeUpdate = () => {
		if (!previewVideoRef.current) return;
		const curr = previewVideoRef.current.currentTime;
		if (curr >= trimEnd) {
			previewVideoRef.current.currentTime = trimStart;
			previewVideoRef.current.play().catch(() => {});
		}
		setPreviewCurrentTime(curr);
	};

	// Trim timeline drag handlers (mirrors VoiceRecorder's trim UX)
	const handleTrimPointerDown = (
		handle: 'start' | 'end',
		e: React.PointerEvent,
	) => {
		e.stopPropagation();
		e.preventDefault();
		draggingHandleRef.current = handle;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	};

	const handleTrimPointerMove = (e: React.PointerEvent) => {
		if (!draggingHandleRef.current || !timelineRef.current || !recordedDuration)
			return;

		const rect = timelineRef.current.getBoundingClientRect();
		const clientX = Math.max(rect.left, Math.min(rect.right, e.clientX));
		const ratio = (clientX - rect.left) / rect.width;
		const targetSec = ratio * recordedDuration;

		if (draggingHandleRef.current === 'start') {
			const newStart = Math.max(0, Math.min(targetSec, trimEnd - 0.5));
			setTrimStart(newStart);
			if (previewVideoRef.current) {
				previewVideoRef.current.currentTime = newStart;
			}
		} else if (draggingHandleRef.current === 'end') {
			const newEnd = Math.min(
				recordedDuration,
				Math.max(targetSec, trimStart + 0.5),
			);
			setTrimEnd(newEnd);
		}
	};

	const handleTrimPointerUp = (e: React.PointerEvent) => {
		if (draggingHandleRef.current) {
			try {
				(e.target as HTMLElement).releasePointerCapture(e.pointerId);
			} catch {
				// pointer capture already released
			}
			draggingHandleRef.current = null;
		}
	};

	// Send video message
	const handleSend = async () => {
		if (!recordedBlobRef.current) return;
		setIsTrimmingOrSending(true);

		try {
			const rawBlob = recordedBlobRef.current;
			let finalBlob = rawBlob;

			// Check if trimming was customized
			const isTrimmed = trimStart > 0.5 || trimEnd < recordedDuration - 0.5;

			if (isTrimmed && previewVideoRef.current) {
				try {
					finalBlob = await trimVideoBlob(
						previewVideoRef.current,
						trimStart,
						trimEnd,
						rawBlob.type,
					);
				} catch (trimErr) {
					console.warn(
						'Trim re-encoding failed, falling back to original blob:',
						trimErr,
					);
					finalBlob = rawBlob;
				}
			}

			const extension = finalBlob.type.includes('mp4') ? 'mp4' : 'webm';
			const file = new File(
				[finalBlob],
				`video_message_${Date.now()}.${extension}`,
				{
					type: finalBlob.type || 'video/mp4',
				},
			);

			onSend(file);
			onClose();
		} catch (err) {
			console.error('Failed to send video message:', err);
		} finally {
			setIsTrimmingOrSending(false);
		}
	};

	// Helper to trim video using canvas capture
	const trimVideoBlob = async (
		video: HTMLVideoElement,
		start: number,
		end: number,
		mimeType: string,
	): Promise<Blob> => {
		return new Promise((resolve) => {
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth || 480;
			canvas.height = video.videoHeight || 480;
			const ctx = canvas.getContext('2d');
			if (!ctx) return resolve(recordedBlobRef.current!);

			const stream = canvas.captureStream(30);

			// Add audio track if present
			try {
				const audioStream =
					(video as any).captureStream?.() ||
					(video as any).mozCaptureStream?.();
				if (audioStream) {
					const audioTracks = audioStream.getAudioTracks();
					if (audioTracks.length > 0) stream.addTrack(audioTracks[0]);
				}
			} catch (_) {}

			const chunks: Blob[] = [];
			const recorder = new MediaRecorder(stream, { mimeType });
			recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) chunks.push(e.data);
			};

			recorder.onstop = () => {
				resolve(new Blob(chunks, { type: mimeType }));
			};

			video.currentTime = start;
			video.onseeked = () => {
				video.onseeked = null;
				recorder.start();

				let animId: number;
				const draw = () => {
					if (video.currentTime >= end || video.paused || video.ended) {
						cancelAnimationFrame(animId);
						if (recorder.state === 'recording') recorder.stop();
						return;
					}
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					animId = requestAnimationFrame(draw);
				};

				video.play().then(() => {
					draw();
				});
			};
		});
	};

	const formatSec = (sec: number) => {
		const s = Math.ceil(sec);
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return `${m}:${rem.toString().padStart(2, '0')}`;
	};

	// Reverse progress perimeter calculations for squircle
	// Width/Height: 256, corner radius: 36
	const width = 256;
	const height = 256;
	const radius = 36;
	const perimeter =
		2 * (width - 2 * radius + height - 2 * radius) + 2 * Math.PI * radius;
	const progressRemaining = timeLeft / MAX_RECORDING_SECONDS;
	const strokeDashoffset = perimeter * (1 - progressRemaining);

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			{/* Suppress built-in dialog close button via [&>button:last-child]:hidden so only one close button exists */}
			<DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 p-0 border-none bg-transparent shadow-none max-w-sm sm:max-w-md w-full flex flex-col items-center justify-center select-none outline-none [&>button:last-child]:hidden">
				<DialogTitle className="sr-only">Record Video Message</DialogTitle>

				{/* Single Dedicated Close Button (aligned with squircle) */}
				<div className="w-64 flex justify-end mb-2 pointer-events-auto">
					<button
						type="button"
						onClick={onClose}
						className="w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center transition cursor-pointer border border-white/20 shadow-lg"
						title="Close"
					>
						<X size={18} />
					</button>
				</div>

				{/* Main Squircle Video Container with WebKit hardware-accelerated clipping */}
				<div
					className="relative w-64 h-64 rounded-[36px] overflow-hidden bg-black shadow-2xl border-2 border-white/15 flex items-center justify-center group"
					style={{
						WebkitMaskImage: '-webkit-radial-gradient(white, black)',
						maskImage: 'radial-gradient(white, black)',
						transform: 'translateZ(0)',
						isolation: 'isolate',
					}}
				>
					{/* Live Camera Feed */}
					{mode !== 'preview' && (
						<video
							ref={liveVideoRef}
							autoPlay
							muted
							playsInline
							className="w-full h-full object-cover scale-x-[-1] rounded-[36px]"
							style={{
								borderRadius: '36px',
								overflow: 'hidden',
								transform: 'scaleX(-1) translateZ(0)',
								WebkitMaskImage: '-webkit-radial-gradient(white, black)',
							}}
						/>
					)}

					{/* Recorded Preview Video */}
					{mode === 'preview' && recordedUrl && (
						<video
							ref={previewVideoRef}
							src={recordedUrl}
							autoPlay
							playsInline
							loop
							onTimeUpdate={handlePreviewTimeUpdate}
							onPlay={() => setPreviewPlaying(true)}
							onPause={() => setPreviewPlaying(false)}
							className="w-full h-full object-cover cursor-pointer rounded-[36px]"
							style={{
								borderRadius: '36px',
								overflow: 'hidden',
								transform: 'translateZ(0)',
								WebkitMaskImage: '-webkit-radial-gradient(white, black)',
							}}
							onClick={() => {
								if (previewVideoRef.current) {
									if (previewVideoRef.current.paused) {
										previewVideoRef.current.play();
									} else {
										previewVideoRef.current.pause();
									}
								}
							}}
						/>
					)}

					{/* Reverse Progress Perimeter Bar around Squircle when recording */}
					{mode === 'recording' && (
						<svg
							className="absolute inset-0 w-full h-full pointer-events-none"
							viewBox="0 0 256 256"
						>
							{/* Track */}
							<rect
								x="4"
								y="4"
								width="248"
								height="248"
								rx={radius}
								ry={radius}
								fill="none"
								stroke="rgba(255,255,255,0.15)"
								strokeWidth="6"
							/>
							{/* Reverse Remaining Progress */}
							<rect
								x="4"
								y="4"
								width="248"
								height="248"
								rx={radius}
								ry={radius}
								fill="none"
								stroke="#e05638"
								strokeWidth="6"
								strokeDasharray={perimeter}
								strokeDashoffset={strokeDashoffset}
								strokeLinecap="round"
								className="transition-all duration-100"
							/>
						</svg>
					)}

					{/* Reverse Countdown Indicator Badge (Top Center) */}
					{mode === 'recording' && (
						<div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-mono font-bold shadow border border-white/10 animate-in fade-in duration-200">
							<span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
							<span>{formatSec(timeLeft)} left</span>
						</div>
					)}

					{/* Camera Switch button (if idle and multiple cameras) */}
					{mode === 'idle' && videoDevices.length > 1 && (
						<button
							type="button"
							onClick={toggleCamera}
							className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white flex items-center justify-center transition cursor-pointer"
							title="Switch Camera"
						>
							<FlipHorizontal size={16} />
						</button>
					)}

					{/* Permission Error State */}
					{hasPermission === false && (
						<div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center text-red-400">
							<AlertCircle size={32} className="mb-2" />
							<span className="text-xs font-semibold">
								Camera Access Denied
							</span>
							<p className="text-[11px] text-muted-foreground mt-1">
								{permissionError ||
									'Please allow camera and microphone permissions.'}
							</p>
						</div>
					)}

					{/* Play/Pause Overlay in Preview */}
					{mode === 'preview' && !previewPlaying && (
						<div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
							<div className="w-12 h-12 rounded-full bg-primary/90 flex items-center justify-center text-primary-foreground shadow-lg">
								<Play size={22} fill="currentColor" className="ml-0.5" />
							</div>
						</div>
					)}
				</div>

				{/* Bottom Action Controls */}
				<div className="mt-4 w-full max-w-xs flex flex-col items-center gap-3">
					{/* Mode: Idle - Record Button */}
					{mode === 'idle' && (
						<div className="flex flex-col items-center gap-2">
							<button
								type="button"
								onClick={startRecording}
								disabled={hasPermission === false}
								className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-red-500/30 transition cursor-pointer group"
								title="Start Recording"
							>
								<div className="w-6 h-6 rounded-full bg-white group-hover:scale-110 transition-transform" />
							</button>
							<span className="text-xs text-white/80 font-medium">
								Tap to start recording (max 60s)
							</span>
						</div>
					)}

					{/* Mode: Recording - Stop Button */}
					{mode === 'recording' && (
						<div className="flex flex-col items-center gap-2">
							<button
								type="button"
								onClick={stopRecording}
								className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-red-600/40 transition cursor-pointer"
								title="Stop Recording"
							>
								<Square size={24} fill="currentColor" />
							</button>
							<span className="text-xs text-red-400 font-medium animate-pulse">
								Recording video message...
							</span>
						</div>
					)}

					{/* Mode: Preview & Trim */}
					{mode === 'preview' && (
						<div className="w-full bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl p-3 flex flex-col gap-3 shadow-xl">
							{/* Trimming Sliders */}
							<div className="flex flex-col gap-1.5 px-1">
								<div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
									<span className="flex items-center gap-1">
										<Scissors size={12} className="text-indigo-400" />
										<span>Trim Video</span>
									</span>
									<span className="font-mono text-white/90">
										{formatSec(trimStart)} - {formatSec(trimEnd)} (
										{Math.max(1, Math.round(trimEnd - trimStart))}s)
									</span>
								</div>

								{(() => {
									const totalDuration = recordedDuration || MAX_RECORDING_SECONDS;
									const startRatio = Math.max(0, Math.min(1, trimStart / totalDuration));
									const endRatio = Math.max(0, Math.min(1, trimEnd / totalDuration));
									const playheadRatio = Math.max(0, Math.min(1, previewCurrentTime / totalDuration));
									return (
										<div
											ref={timelineRef}
											onPointerMove={handleTrimPointerMove}
											onPointerUp={handleTrimPointerUp}
											className="relative h-9 flex items-center px-1 cursor-pointer overflow-hidden rounded bg-white/5 border border-white/10"
											onClick={(e) => {
												if (!timelineRef.current || !previewVideoRef.current) return;
												const rect = timelineRef.current.getBoundingClientRect();
												const clickRatio = (e.clientX - rect.left) / rect.width;
												const seekTime = clickRatio * totalDuration;
												const clamped = Math.max(trimStart, Math.min(trimEnd, seekTime));
												previewVideoRef.current.currentTime = clamped;
												setPreviewCurrentTime(clamped);
											}}
										>
											{/* Dim trimmed-out left region */}
											<div
												className="absolute top-0 bottom-0 left-0 bg-black/50 backdrop-blur-[1px] pointer-events-none z-10"
												style={{ width: `${startRatio * 100}%` }}
											/>

											{/* Highlighted kept window */}
											<div
												className="absolute top-0 bottom-0 border-y-2 border-indigo-400/60 bg-indigo-400/10 pointer-events-none z-10"
												style={{
													left: `${startRatio * 100}%`,
													width: `${(endRatio - startRatio) * 100}%`,
												}}
											/>

											{/* Dim trimmed-out right region */}
											<div
												className="absolute top-0 bottom-0 right-0 bg-black/50 backdrop-blur-[1px] pointer-events-none z-10"
												style={{ width: `${(1 - endRatio) * 100}%` }}
											/>

											{/* Playhead */}
											<div
												className="absolute top-0 bottom-0 w-[2px] bg-white shadow-sm pointer-events-none z-20"
												style={{ left: `${playheadRatio * 100}%` }}
											/>

											{/* Neutral time-tick bars (no waveform available for video) */}
											<div className="flex items-center justify-between gap-[2px] w-full h-full px-1">
												{Array.from({ length: 40 }).map((_, idx) => {
													const barRatio = idx / 40;
													const isInside = barRatio >= startRatio && barRatio <= endRatio;
													return (
														<div
															key={idx}
															className={`flex-1 rounded-full transition-colors ${
																isInside ? 'bg-indigo-400/70' : 'bg-white/15'
															}`}
															style={{ height: '60%' }}
														/>
													);
												})}
											</div>

											{/* Left Trim Handle */}
											<div
												onPointerDown={(e) => handleTrimPointerDown('start', e)}
												style={{ left: `${startRatio * 100}%` }}
												className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-30 group touch-none"
												title="Drag to trim start"
											>
												<div className="w-1.5 h-6 bg-indigo-400 rounded-full shadow group-hover:scale-110 transition-transform" />
											</div>

											{/* Right Trim Handle */}
											<div
												onPointerDown={(e) => handleTrimPointerDown('end', e)}
												style={{ left: `${endRatio * 100}%` }}
												className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-30 group touch-none"
												title="Drag to trim end"
											>
												<div className="w-1.5 h-6 bg-indigo-400 rounded-full shadow group-hover:scale-110 transition-transform" />
											</div>
										</div>
									);
								})()}
							</div>

							{/* Actions: Retake, Cancel, Send */}
							<div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
								<button
									type="button"
									onClick={handleRetake}
									disabled={isTrimmingOrSending}
									className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 transition cursor-pointer"
								>
									<RotateCcw size={14} />
									<span>Retake</span>
								</button>

								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={onClose}
										disabled={isTrimmingOrSending}
										className="px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-white transition cursor-pointer"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleSend}
										disabled={isTrimmingOrSending}
										className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-1.5 transition cursor-pointer shadow-md"
									>
										{isTrimmingOrSending ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<Send size={14} />
										)}
										<span>Send</span>
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
