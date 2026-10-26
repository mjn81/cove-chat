import React, { useState, useEffect, useRef } from 'react';
import {
	Play,
	Volume2,
	VolumeX,
	Loader2,
	AlertCircle,
	Maximize2,
} from 'lucide-react';
import type { Message } from '@/types/api';
import { decryptMessage, getChannelKey, base64ToBytes, onWS } from '@/ws';
import { decryptAndDecompressFile } from '@/utils/file';
import { apiGetFile } from '@/api/client';
import { db } from '@/lib/db';
import { CustomVideoPlayer } from './File/CustomVideoPlayer';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '@/components/modal-shell';

interface VideoMessageBubbleProps {
	msg: Message;
}

interface VideoMetadata {
	file_id: string;
	name?: string;
	mime: string;
	size: number;
	duration?: number;
	nonce: string;
	thumb_ciphertext?: string;
	thumb_nonce?: string;
	processing_status?: 'processing' | 'ready' | 'failed';
}

export const VideoMessageBubble: React.FC<VideoMessageBubbleProps> = ({ msg }) => {
	const { t } = useTranslation();
	const [meta, setMeta] = useState<VideoMetadata | null>(null);
	const [videoUrl, setVideoUrl] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [isMuted, setIsMuted] = useState(true);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [isProcessing, setIsProcessing] = useState(false);
	const [isPlayerOpen, setIsPlayerOpen] = useState(false);

	const videoRef = useRef<HTMLVideoElement | null>(null);
	const metaRef = useRef<VideoMetadata | null>(null);
	useEffect(() => {
		metaRef.current = meta;
	}, [meta]);

	// Load and decrypt metadata & video file
	useEffect(() => {
		let isMounted = true;
		const loadMeta = async () => {
			const key = getChannelKey(msg.channel_id);
			if (!key) return;

			try {
				const decrypted = await decryptMessage(msg);
				if (!decrypted || decrypted === '[encrypted]' || decrypted === '[decryption failed]') {
					return;
				}
				const parsed = JSON.parse(decrypted) as VideoMetadata;
				if (isMounted) {
					setMeta(parsed);
					if (parsed.duration) setDuration(parsed.duration);
					if (parsed.processing_status === 'processing') {
						setIsProcessing(true);
					}
				}

				// Check cache first
				const cached = await db.getCachedFile(parsed.file_id);
				if (cached && isMounted) {
					const blob = new Blob([cached.data as any], { type: cached.mime });
					setVideoUrl(URL.createObjectURL(blob));
					return;
				}

				// Automatically download and decrypt to enable autoplay in feed
				if (isMounted) {
					downloadAndDecrypt(parsed, key);
				}
			} catch (err) {
				console.warn('Failed to parse video message metadata:', err);
			}
		};

		loadMeta();

		// Listen for video_ready WS event
		const unsub = onWS('video_ready', (payload: any) => {
			const currentMeta = metaRef.current;
			if (payload?.file_id && currentMeta && payload.file_id === currentMeta.file_id) {
				setIsProcessing(false);
				const key = getChannelKey(msg.channel_id);
				if (key) downloadAndDecrypt(currentMeta, key);
			}
		});

		return () => {
			isMounted = false;
			unsub();
		};
	}, [msg.id, msg.channel_id, msg.ciphertext]);

	const downloadAndDecrypt = async (metadata: VideoMetadata, key: Uint8Array) => {
		setIsLoading(true);
		setError(null);
		try {
			const encryptedBuffer = await apiGetFile(metadata.file_id, (p) => {
				if (p.total) setDownloadProgress(Math.round((p.loaded * 100) / p.total));
			});

			const decryptedBytes = await decryptAndDecompressFile(
				new Uint8Array(encryptedBuffer),
				base64ToBytes(metadata.nonce),
				key,
				false,
			);

			await db.cacheFile(
				metadata.file_id,
				decryptedBytes,
				metadata.mime || 'video/mp4',
				metadata.size,
			);

			const blob = new Blob([decryptedBytes as any], {
				type: metadata.mime || 'video/mp4',
			});
			setVideoUrl(URL.createObjectURL(blob));
		} catch (err: any) {
			console.error('Failed to download/decrypt video message:', err);
			setError(err.message || 'Failed to load video');
		} finally {
			setIsLoading(false);
		}
	};

	// Open in Custom Video Player modal when clicked
	const handleBubbleClick = () => {
		if (videoUrl) {
			setIsPlayerOpen(true);
		} else {
			const key = getChannelKey(msg.channel_id);
			if (key && meta) {
				downloadAndDecrypt(meta, key);
			}
		}
	};

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

	// Ring is inset 4px inside the 32px-radius tile, so its corner radius is 32 - 4 = 28 to stay concentric with the edge.
	const w = 248;
	const h = 248;
	const r = 28;
	const sqPerimeter = 2 * (w - 2 * r + h - 2 * r) + 2 * Math.PI * r;
	const sqDashoffset = sqPerimeter * (1 - progress);

	return (
		<div className="relative inline-block select-none my-1">
			{/* Squircle (rounded-square) video wrapper */}
			<div
				className="relative w-64 h-64 rounded-[32px] overflow-hidden bg-black shadow-lg cursor-pointer group border border-border/50 hover:border-primary/50 transition-all hover:scale-[1.01]"
				onClick={handleBubbleClick}
				title="Click to play in video player"
			>
				{videoUrl ? (
					<video
						ref={videoRef}
						src={videoUrl}
						autoPlay
						playsInline
						muted={isMuted}
						onTimeUpdate={() => {
							if (videoRef.current) {
								setCurrentTime(videoRef.current.currentTime);
								if (!duration && videoRef.current.duration) {
									setDuration(videoRef.current.duration);
								}
							}
						}}
						onLoadedMetadata={() => {
							if (videoRef.current?.duration) {
								setDuration(videoRef.current.duration);
							}
						}}
						className="w-full h-full object-cover"
					/>
				) : (
					<div className="w-full h-full bg-secondary/80 flex items-center justify-center">
						{isLoading ? (
							<div className="flex flex-col items-center gap-2 text-primary">
								<Loader2 size={32} className="animate-spin" />
								<span className="text-[11px] font-mono">{downloadProgress}%</span>
							</div>
						) : isProcessing ? (
							<div className="flex flex-col items-center gap-2 text-muted-foreground p-4 text-center">
								<Loader2 size={28} className="animate-spin text-primary" />
								<span className="text-xs font-medium">Processing video...</span>
							</div>
						) : (
							<div className="w-14 h-14 rounded-2xl bg-primary/90 flex items-center justify-center text-primary-foreground shadow-lg group-hover:scale-110 transition">
								<Play size={26} fill="currentColor" className="ms-1" />
							</div>
						)}
					</div>
				)}

				{/* Hover Expand / Play Icon Overlay */}
				{videoUrl && (
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
							className="stroke-primary transition-all duration-150"
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
					<div className="bg-black/60 backdrop-blur-md px-2.5 py-0.5 rounded-full text-[11px] font-mono text-white/90 shadow border border-white/10">
						{formatTime(currentTime)} / {formatTime(duration)}
					</div>

					{/* Quick Mute Toggle Button in feed */}
					{videoUrl && (
						<button
							type="button"
							onClick={toggleMute}
							className="pointer-events-auto w-7 h-7 rounded-full bg-black/60 backdrop-blur-md text-white/90 hover:text-white flex items-center justify-center transition hover:scale-110 active:scale-95 border border-white/10"
							title={isMuted ? 'Unmute preview' : 'Mute preview'}
						>
							{isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
						</button>
					)}
				</div>

				{/* Processing badge overlay */}
				{isProcessing && !videoUrl && (
					<div className="absolute top-3 left-1/2 -translate-x-1/2 bg-warning/80 backdrop-blur-sm text-warning-foreground font-semibold text-[10px] px-2.5 py-0.5 rounded-full shadow">
						Converting...
					</div>
				)}

				{/* Error Overlay */}
				{error && (
					<div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center p-4 text-center text-destructive">
						<AlertCircle size={24} />
						<span className="text-xs mt-1 font-medium">{error}</span>
					</div>
				)}
			</div>

			{/* Fullscreen Video Player Modal */}
			<ModalShell
				open={isPlayerOpen}
				onOpenChange={setIsPlayerOpen}
				title={t('chat.video.player_title')}
				size="media"
				bodyClassName="flex items-center justify-center p-4"
			>
				{videoUrl && (
					<CustomVideoPlayer
						src={videoUrl}
						autoPlay
						className="max-h-[80vh] w-full overflow-hidden rounded-lg"
					/>
				)}
			</ModalShell>
		</div>
	);
};
