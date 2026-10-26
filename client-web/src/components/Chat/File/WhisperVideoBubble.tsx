import React, { useState, useRef, useEffect } from 'react';
import { Play, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import type { WhisperMessageFile } from '@/store/whisperStore';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '@/components/modal-shell';

interface WhisperVideoBubbleProps {
	file: WhisperMessageFile;
}

export const WhisperVideoBubble: React.FC<WhisperVideoBubbleProps> = ({ file }) => {
	const { t } = useTranslation();
	const [isMuted, setIsMuted] = useState(true);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(file.duration || 0);
	const [isPlayerOpen, setIsPlayerOpen] = useState(false);

	const videoRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		let rafId: number | null = null;

		const update = () => {
			if (!video.paused && !video.ended) {
				setCurrentTime(video.currentTime);
				rafId = requestAnimationFrame(update);
			}
		};

		const onPlay = () => {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(update);
		};

		const onPauseOrEnd = () => {
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			setCurrentTime(video.currentTime);
		};

		const onLoadedMetadata = () => {
			if (video.duration && isFinite(video.duration)) {
				setDuration(video.duration);
			}
		};

		video.addEventListener('play', onPlay);
		video.addEventListener('pause', onPauseOrEnd);
		video.addEventListener('ended', onPauseOrEnd);
		video.addEventListener('loadedmetadata', onLoadedMetadata);

		// If autoplay kicked off immediately
		if (!video.paused && !video.ended) {
			rafId = requestAnimationFrame(update);
		}

		return () => {
			if (rafId) cancelAnimationFrame(rafId);
			video.removeEventListener('play', onPlay);
			video.removeEventListener('pause', onPauseOrEnd);
			video.removeEventListener('ended', onPauseOrEnd);
			video.removeEventListener('loadedmetadata', onLoadedMetadata);
		};
	}, []);

	const toggleMute = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!videoRef.current) return;
		const nextMuted = !isMuted;
		videoRef.current.muted = nextMuted;
		setIsMuted(nextMuted);
	};

	const formatTime = (sec: number) => {
		if (!isFinite(sec) || isNaN(sec)) return '0:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	};

	const progress = duration > 0 ? currentTime / duration : 0;

	// Perimeter for squircle with width=248, height=248, rx=32
	const w = 248;
	const h = 248;
	const r = 32;
	const sqPerimeter = 2 * (w - 2 * r + h - 2 * r) + 2 * Math.PI * r;
	const sqDashoffset = sqPerimeter * (1 - progress);

	return (
		<div className="relative inline-block select-none my-1">
			{/* Squircle (rounded-square) video wrapper */}
			<div
				className="relative w-64 h-64 rounded-[32px] overflow-hidden bg-black shadow-lg cursor-pointer group border border-border/50 hover:border-primary/50 transition-all hover:scale-[1.01]"
				onClick={() => setIsPlayerOpen(true)}
				title="Click to play in video player"
			>
				{file.blobUrl ? (
					<video
						ref={videoRef}
						src={file.blobUrl}
						autoPlay
						loop
						playsInline
						muted={isMuted}
						className="w-full h-full object-cover"
					/>
				) : (
					<div className="w-full h-full bg-secondary/80 flex items-center justify-center">
						<div className="w-14 h-14 rounded-2xl bg-primary/90 flex items-center justify-center text-primary-foreground shadow-lg group-hover:scale-110 transition">
							<Play size={26} fill="currentColor" className="ms-1" />
						</div>
					</div>
				)}

				{/* Hover Expand / Play Icon Overlay */}
				{file.blobUrl && (
					<div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
						<div className="w-12 h-12 rounded-2xl bg-black/60 backdrop-blur-md flex items-center justify-center text-white shadow-lg border border-white/10 group-hover:scale-105 transition-transform">
							<Maximize2 size={20} />
						</div>
					</div>
				)}

				{/* SVG Perimeter Progress Bar wrapping around the squircle */}
				<svg
					className="absolute inset-0 w-full h-full pointer-events-none"
					viewBox="0 0 256 256"
				>
					{/* Track */}
					<rect
						x="4"
						y="4"
						width={w}
						height={h}
						rx={r}
						ry={r}
						className="stroke-black/30"
						strokeWidth="5"
						fill="transparent"
					/>
					{/* Active Progress */}
					{progress > 0 && (
						<rect
							x="4"
							y="4"
							width={w}
							height={h}
							rx={r}
							ry={r}
							className="stroke-primary transition-none"
							strokeWidth="5"
							strokeDasharray={sqPerimeter}
							strokeDashoffset={sqDashoffset}
							strokeLinecap="round"
							fill="transparent"
						/>
					)}
				</svg>

				{/* Bottom Controls Overlay */}
				<div className="absolute bottom-3 inset-x-0 flex items-center justify-between px-4 pointer-events-none">
					{/* Duration Pill */}
					<div className="bg-black/60 backdrop-blur-md border border-white/10 text-white text-[11px] font-mono px-2 py-0.5 rounded-full">
						{currentTime > 0 ? formatTime(currentTime) : formatTime(duration)}
					</div>

					{/* Mute Toggle */}
					<button
						type="button"
						onClick={toggleMute}
						className="p-1.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-white transition pointer-events-auto cursor-pointer"
						title={isMuted ? 'Unmute' : 'Mute'}
					>
						{isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
					</button>
				</div>
			</div>

			{/* Modal Player Dialog */}
			<ModalShell
				open={isPlayerOpen}
				onOpenChange={setIsPlayerOpen}
				title={t('chat.video.player_title')}
				size="media"
			>
				<CustomVideoPlayer
					src={file.blobUrl || ''}
					autoPlay
					className="max-h-[80vh] w-full"
				/>
			</ModalShell>
		</div>
	);
};
