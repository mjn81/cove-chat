import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clampTrimEnd, clampTrimStart, pointerToSeconds } from '@/utils/trim';
import { logger } from '@/utils/logger';
import { trimVideoBlob } from '../utils/trim-video';
import {
	MAX_VIDEO_SECONDS,
	isVideoTrimmed,
	pickVideoMimeType,
	videoFileMeta,
} from '../utils/video-recording';

export type VideoRecorderMode = 'idle' | 'recording' | 'preview';

interface UseVideoRecorderArgs {
	/** Whether the dialog is showing; the camera runs only while it is. */
	open: boolean;
	onClose: () => void;
	onSend: (file: File) => void;
}

/**
 * State machine behind the round video-message recorder: camera selection,
 * recording with a 60 s countdown, preview with looped trim range, and
 * sending (re-encoding only when the user actually trimmed). The camera
 * stream is stopped whenever the dialog closes or the take finishes.
 */
export function useVideoRecorder({ open, onClose, onSend }: UseVideoRecorderArgs) {
	const { t } = useTranslation();
	const [mode, setMode] = useState<VideoRecorderMode>('idle');
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);
	const [permissionError, setPermissionError] = useState<string | null>(null);
	const [timeLeft, setTimeLeft] = useState(MAX_VIDEO_SECONDS);
	const [recordedDuration, setRecordedDuration] = useState(0);
	const [trimStart, setTrimStart] = useState(0);
	const [trimEnd, setTrimEnd] = useState(MAX_VIDEO_SECONDS);
	const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
	const [previewPlaying, setPreviewPlaying] = useState(true);
	const [isBusy, setIsBusy] = useState(false);
	const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);
	const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

	const streamRef = useRef<MediaStream | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const startTimeRef = useRef(0);
	const liveVideoRef = useRef<HTMLVideoElement | null>(null);
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const recordedBlobRef = useRef<Blob | null>(null);
	const timelineRef = useRef<HTMLDivElement | null>(null);
	const draggingHandleRef = useRef<'start' | 'end' | null>(null);

	const stopStream = useCallback(() => {
		streamRef.current?.getTracks().forEach((track) => track.stop());
		streamRef.current = null;
	}, []);

	const startCamera = useCallback(
		async (deviceId?: string) => {
			stopStream();
			setPermissionError(null);
			if (!navigator?.mediaDevices?.getUserMedia) {
				setHasPermission(false);
				setPermissionError(t('videoRecorder.unsupported'));
				return;
			}
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: true, noiseSuppression: true },
					video: {
						width: { ideal: 720 },
						height: { ideal: 720 },
						aspectRatio: { ideal: 1 },
						facingMode: deviceId ? undefined : 'user',
						deviceId: deviceId ? { exact: deviceId } : undefined,
					},
				});
				streamRef.current = stream;
				setHasPermission(true);

				if (liveVideoRef.current) {
					liveVideoRef.current.srcObject = stream;
					liveVideoRef.current.play().catch((e) => logger.warn('Camera play error', { error: String(e) }));
				}

				try {
					const devices = await navigator.mediaDevices.enumerateDevices();
					setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
				} catch {
					// listing cameras is optional; switching is just unavailable
				}
			} catch (err) {
				logger.error('Camera access failed', { error: String(err) });
				setHasPermission(false);
				setPermissionError(err instanceof Error && err.message ? err.message : t('videoRecorder.access_failed'));
			}
		},
		[stopStream, t],
	);

	const resetTake = useCallback(() => {
		recordedBlobRef.current = null;
		setMode('idle');
		setTimeLeft(MAX_VIDEO_SECONDS);
		setRecordedDuration(0);
		setTrimStart(0);
		setTrimEnd(MAX_VIDEO_SECONDS);
		setPreviewPlaying(true);
		setIsBusy(false);
	}, []);

	// Keep the live preview bound to the camera stream whenever the <video> (re)mounts.
	useEffect(() => {
		if (liveVideoRef.current && streamRef.current && mode !== 'preview') {
			liveVideoRef.current.srcObject = streamRef.current;
			liveVideoRef.current.play().catch(() => {});
		}
	}, [mode, hasPermission, open]);

	// Open/close lifecycle: only `open` should restart or stop the camera.
	useEffect(() => {
		if (open) {
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
			mediaRecorderRef.current = null;
			chunksRef.current = [];
			/* eslint-disable react-hooks/set-state-in-effect */
			setRecordedUrl(null);
			resetTake();
			/* eslint-enable react-hooks/set-state-in-effect */
			startCamera();
		} else {
			stopStream();
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
			if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
				try {
					mediaRecorderRef.current.stop();
				} catch {
					// recorder already stopped
				}
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
	}, [open, startCamera, stopStream, resetTake]);

	const toggleCamera = () => {
		if (videoDevices.length <= 1) return;
		const next = (selectedDeviceIndex + 1) % videoDevices.length;
		setSelectedDeviceIndex(next);
		startCamera(videoDevices[next].deviceId);
	};

	const stopRecording = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (mediaRecorderRef.current?.state === 'recording') {
			try {
				mediaRecorderRef.current.stop();
			} catch (e) {
				logger.error('Stop recorder error', { error: String(e) });
			}
		}
	}, []);

	const startRecording = () => {
		if (!streamRef.current) return;
		chunksRef.current = [];

		const supported = pickVideoMimeType((type) => MediaRecorder.isTypeSupported(type));
		const recorder = new MediaRecorder(streamRef.current, supported ? { mimeType: supported } : {});

		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
		};
		recorder.onstop = () => {
			const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/mp4' });
			recordedBlobRef.current = blob;
			setRecordedUrl(URL.createObjectURL(blob));

			const elapsed = (Date.now() - startTimeRef.current) / 1000;
			const dur = Math.min(MAX_VIDEO_SECONDS, Math.max(1, elapsed));
			setRecordedDuration(dur);
			setTrimStart(0);
			setTrimEnd(dur);

			setMode('preview');
			stopStream();
		};

		mediaRecorderRef.current = recorder;
		startTimeRef.current = Date.now();
		recorder.start(200);
		setMode('recording');
		setTimeLeft(MAX_VIDEO_SECONDS);

		if (timerRef.current) clearInterval(timerRef.current);
		timerRef.current = setInterval(() => {
			const remaining = Math.max(0, MAX_VIDEO_SECONDS - (Date.now() - startTimeRef.current) / 1000);
			setTimeLeft(remaining);
			if (remaining <= 0) stopRecording();
		}, 100);
	};

	const retake = () => {
		if (recordedUrl) {
			URL.revokeObjectURL(recordedUrl);
			setRecordedUrl(null);
		}
		resetTake();
		startCamera();
	};

	/** Loops the preview inside the trimmed range. */
	const onPreviewTimeUpdate = () => {
		const video = previewVideoRef.current;
		if (!video) return;
		if (video.currentTime >= trimEnd) {
			video.currentTime = trimStart;
			video.play().catch(() => {});
		}
		setPreviewCurrentTime(video.currentTime);
	};

	const togglePreviewPlay = () => {
		const video = previewVideoRef.current;
		if (!video) return;
		if (video.paused) video.play();
		else video.pause();
	};

	const beginDrag = (handle: 'start' | 'end', e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		draggingHandleRef.current = handle;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: React.PointerEvent) => {
		const handle = draggingHandleRef.current;
		if (!handle || !timelineRef.current || !recordedDuration) return;
		const target = pointerToSeconds(e.clientX, timelineRef.current.getBoundingClientRect(), recordedDuration);

		if (handle === 'start') {
			const next = clampTrimStart(target, trimEnd);
			setTrimStart(next);
			if (previewVideoRef.current) previewVideoRef.current.currentTime = next;
		} else {
			setTrimEnd(clampTrimEnd(target, trimStart, recordedDuration));
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

	const seekTo = (clientX: number) => {
		if (!timelineRef.current || !previewVideoRef.current) return;
		const total = recordedDuration || MAX_VIDEO_SECONDS;
		const seconds = pointerToSeconds(clientX, timelineRef.current.getBoundingClientRect(), total);
		const clamped = Math.max(trimStart, Math.min(trimEnd, seconds));
		previewVideoRef.current.currentTime = clamped;
		setPreviewCurrentTime(clamped);
	};

	const send = async () => {
		const raw = recordedBlobRef.current;
		if (!raw) return;
		setIsBusy(true);
		try {
			let finalBlob = raw;
			if (isVideoTrimmed(trimStart, trimEnd, recordedDuration) && previewVideoRef.current) {
				try {
					finalBlob = await trimVideoBlob(previewVideoRef.current, trimStart, trimEnd, raw.type, raw);
				} catch (trimErr) {
					logger.warn('Trim re-encoding failed, using the original recording', { error: String(trimErr) });
				}
			}
			const meta = videoFileMeta(finalBlob.type, Date.now());
			onSend(new File([finalBlob], meta.name, { type: meta.type }));
			onClose();
		} catch (err) {
			logger.error('Failed to send video message', { error: String(err) });
		} finally {
			setIsBusy(false);
		}
	};

	return {
		mode,
		hasPermission,
		permissionError,
		timeLeft,
		recordedDuration,
		trimStart,
		trimEnd,
		previewCurrentTime,
		previewPlaying,
		setPreviewPlaying,
		isBusy,
		videoDevices,
		recordedUrl,
		liveVideoRef,
		previewVideoRef,
		timelineRef,
		toggleCamera,
		startRecording,
		stopRecording,
		retake,
		onPreviewTimeUpdate,
		togglePreviewPlay,
		beginDrag,
		onPointerMove,
		onPointerUp,
		seekTo,
		send,
	};
}
