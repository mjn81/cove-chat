// guardrail-allow physicalClass: media timelines, scrubbers and waveforms run left-to-right in RTL UIs too.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
	Play,
	Pause,
	Volume2,
	Volume1,
	VolumeX,
	Maximize,
	Minimize,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface CustomVideoPlayerProps {
	src: string;
	autoPlay?: boolean;
	poster?: string;
	onEnded?: () => void;
	className?: string;
}

export const CustomVideoPlayer: React.FC<CustomVideoPlayerProps> = ({
	src,
	autoPlay = true,
	poster,
	onEnded,
	className = '',
}) => {
	const videoRef = useRef<HTMLVideoElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const speedMenuRef = useRef<HTMLDivElement>(null);
	const isDraggingSpeedRef = useRef(false);

	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [buffered, setBuffered] = useState(0);

	// Persisted volume and mute state
	const [volume, setVolume] = useState(() => {
		const saved = localStorage.getItem('nodetalk_player_volume');
		return saved !== null ? parseFloat(saved) : 1;
	});
	const [isMuted, setIsMuted] = useState(() => {
		const saved = localStorage.getItem('nodetalk_player_muted');
		return saved === 'true';
	});

	const [playbackRate, setPlaybackRate] = useState(1.0);
	const [showSpeedSlider, setShowSpeedSlider] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isControlsVisible, setIsControlsVisible] = useState(true);
	const [centerFeedback, setCenterFeedback] = useState<'play' | 'pause' | null>(null);
	const [hoverTime, setHoverTime] = useState<number | null>(null);
	const [hoverPos, setHoverPos] = useState<number | null>(null);
	const [isVolumeHovered, setIsVolumeHovered] = useState(false);

	// Sync volume with native video
	useEffect(() => {
		if (videoRef.current) {
			videoRef.current.volume = volume;
			videoRef.current.muted = isMuted;
		}
	}, [volume, isMuted]);

	// Auto-play on mount
	useEffect(() => {
		if (videoRef.current && autoPlay) {
			const playPromise = videoRef.current.play();
			if (playPromise !== undefined) {
				playPromise
					.then(() => setIsPlaying(true))
					.catch(() => {
						// Auto-play with sound might be blocked by browser policy; try muted fallback
						if (videoRef.current) {
							videoRef.current.muted = true;
							setIsMuted(true);
							videoRef.current
								.play()
								.then(() => setIsPlaying(true))
								.catch((e) => console.warn('Autoplay failed:', e));
						}
					});
			}
		}
	}, [autoPlay, src]);

	// Controls auto-hide logic
	const resetHideTimer = useCallback(() => {
		setIsControlsVisible(true);
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

		if (isPlaying && !showSpeedSlider) {
			hideTimerRef.current = setTimeout(() => {
				setIsControlsVisible(false);
			}, 2500);
		}
	}, [isPlaying, showSpeedSlider]);

	useEffect(() => {
		return () => {
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		};
	}, []);

	const isControlsEffectivelyVisible = isControlsVisible || !isPlaying || showSpeedSlider;

	// Listen for fullscreen change
	useEffect(() => {
		const onFullscreenChange = () => {
			setIsFullscreen(Boolean(document.fullscreenElement));
		};
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	}, []);

	// Handle pointerup to reset drag tracking
	useEffect(() => {
		const onPointerUp = () => {
			isDraggingSpeedRef.current = false;
		};
		window.addEventListener('pointerup', onPointerUp);
		return () => window.removeEventListener('pointerup', onPointerUp);
	}, []);

	// Click outside listener for speed popup
	useEffect(() => {
		if (!showSpeedSlider) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
				setShowSpeedSlider(false);
			}
		};
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [showSpeedSlider]);

	// Smooth playback progress sync via requestAnimationFrame
	useEffect(() => {
		if (!isPlaying) return;
		let rafId: number;
		const tick = () => {
			if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
				setCurrentTime(videoRef.current.currentTime);
				rafId = requestAnimationFrame(tick);
			}
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, [isPlaying]);

	// Native video event listeners
	const handleTimeUpdate = () => {
		if (!videoRef.current) return;
		setCurrentTime(videoRef.current.currentTime);

		// Calculate buffered percentage
		const buf = videoRef.current.buffered;
		if (buf.length > 0 && videoRef.current.duration > 0) {
			for (let i = buf.length - 1; i >= 0; i--) {
				if (buf.start(i) <= videoRef.current.currentTime) {
					setBuffered((buf.end(i) / videoRef.current.duration) * 100);
					break;
				}
			}
		}
	};

	const handleLoadedMetadata = () => {
		if (videoRef.current) {
			setDuration(videoRef.current.duration || 0);
			videoRef.current.playbackRate = playbackRate;
		}
	};

	const triggerCenterFeedback = (type: 'play' | 'pause') => {
		setCenterFeedback(type);
		setTimeout(() => setCenterFeedback(null), 500);
	};

	const togglePlay = useCallback(() => {
		if (!videoRef.current) return;
		if (videoRef.current.paused || videoRef.current.ended) {
			videoRef.current.play().then(() => {
				setIsPlaying(true);
				triggerCenterFeedback('play');
			});
		} else {
			videoRef.current.pause();
			setIsPlaying(false);
			triggerCenterFeedback('pause');
		}
		resetHideTimer();
	}, [resetHideTimer]);

	const handleSeek = (values: number[]) => {
		if (!videoRef.current) return;
		const newTime = values[0];
		videoRef.current.currentTime = newTime;
		setCurrentTime(newTime);
		resetHideTimer();
	};

	const handleVolumeChange = (values: number[]) => {
		const newVol = values[0];
		setVolume(newVol);
		localStorage.setItem('nodetalk_player_volume', String(newVol));
		if (newVol > 0 && isMuted) {
			setIsMuted(false);
			localStorage.setItem('nodetalk_player_muted', 'false');
		}
		resetHideTimer();
	};

	const toggleMute = () => {
		const nextMuted = !isMuted;
		setIsMuted(nextMuted);
		localStorage.setItem('nodetalk_player_muted', String(nextMuted));
		if (videoRef.current) {
			videoRef.current.muted = nextMuted;
		}
		resetHideTimer();
	};

	const handleRateChange = (rate: number) => {
		setPlaybackRate(rate);
		if (videoRef.current) {
			videoRef.current.playbackRate = rate;
		}
		resetHideTimer();
	};

	const toggleFullscreen = async () => {
		if (!containerRef.current) return;
		try {
			if (!document.fullscreenElement) {
				await containerRef.current.requestFullscreen();
			} else {
				await document.exitFullscreen();
			}
		} catch (err) {
			console.warn('Fullscreen toggle failed:', err);
		}
	};

	// Keyboard shortcut handling
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === ' ' || e.key === 'k') {
			e.preventDefault();
			togglePlay();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			if (videoRef.current) {
				videoRef.current.currentTime = Math.min(duration, currentTime + 5);
			}
			resetHideTimer();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			if (videoRef.current) {
				videoRef.current.currentTime = Math.max(0, currentTime - 5);
			}
			resetHideTimer();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const newVol = Math.min(1, volume + 0.1);
			setVolume(newVol);
			if (isMuted) setIsMuted(false);
			resetHideTimer();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			const newVol = Math.max(0, volume - 0.1);
			setVolume(newVol);
			resetHideTimer();
		} else if (e.key === 'm') {
			e.preventDefault();
			toggleMute();
		} else if (e.key === 'f') {
			e.preventDefault();
			toggleFullscreen();
		}
	};

	const formatTime = (timeInSec: number) => {
		if (isNaN(timeInSec) || !isFinite(timeInSec)) return '0:00';
		const totalSec = Math.floor(timeInSec);
		const minutes = Math.floor(totalSec / 60);
		const seconds = totalSec % 60;
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			const remMinutes = minutes % 60;
			return `${hours}:${String(remMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		}
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	};

	return (
		<div
			ref={containerRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onMouseMove={resetHideTimer}
			onMouseLeave={() => isPlaying && !showSpeedSlider && setIsControlsVisible(false)}
			className={`relative group/player w-full h-full max-h-[80vh] flex items-center justify-center select-none outline-none focus:outline-none bg-black/90 rounded-2xl overflow-hidden pointer-events-auto ${className}`}
			onClick={(e) => e.stopPropagation()}
		>
			{/* Native Video Element for maximum hardware-accelerated performance */}
			<video
				ref={videoRef}
				src={src}
				poster={poster}
				playsInline
				onTimeUpdate={handleTimeUpdate}
				onLoadedMetadata={handleLoadedMetadata}
				onPlay={() => setIsPlaying(true)}
				onPause={() => setIsPlaying(false)}
				onEnded={() => {
					setIsPlaying(false);
					onEnded?.();
				}}
				onClick={togglePlay}
				className="w-full h-full max-h-[80vh] object-contain cursor-pointer"
			/>

			{/* Center Splash Feedback on Play/Pause Toggle */}
			{centerFeedback && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
					<div className="w-14 h-14 rounded-full bg-background/90 text-foreground backdrop-blur-md flex items-center justify-center shadow-2xl animate-out fade-out zoom-out duration-500 border border-white/10">
						{centerFeedback === 'play' ? (
							<Play size={26} fill="currentColor" />
						) : (
							<Pause size={26} fill="currentColor" />
						)}
					</div>
				</div>
			)}

			{/* Center Play Button when Paused - matches picture download button size */}
			{!isPlaying && !centerFeedback && (
				<button
					type="button"
					onClick={togglePlay}
					className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-background/90 hover:bg-background text-foreground shadow-2xl backdrop-blur-md flex items-center justify-center border border-white/10 hover:scale-110 active:scale-95 transition-all z-20 cursor-pointer"
					title="Play"
				>
					<Play size={22} fill="currentColor" />
				</button>
			)}

			{/* Custom Controls Overlay */}
			<div
				className={`absolute bottom-0 left-0 right-0 p-4 transition-all duration-300 z-30 pointer-events-auto ${
					isControlsEffectivelyVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
				}`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex flex-col gap-2.5 bg-black/75 backdrop-blur-md rounded-2xl p-3 border border-white/10 shadow-2xl max-w-2xl mx-auto">
					{/* Interactive Timeline Scrubber */}
					<div
						className="relative group/scrubber flex items-center cursor-pointer pt-1"
						onMouseMove={(e) => {
							const rect = e.currentTarget.getBoundingClientRect();
							const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
							setHoverPos(pos);
							setHoverTime(pos * duration);
						}}
						onMouseLeave={() => {
							setHoverPos(null);
							setHoverTime(null);
						}}
					>
						{/* Hover Time Tooltip */}
						{hoverPos !== null && hoverTime !== null && duration > 0 && (
							<div
								className="absolute -top-7 transform -translate-x-1/2 bg-black/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded shadow pointer-events-none border border-white/15 tabular-nums"
								style={{ left: `${hoverPos * 100}%` }}
							>
								{formatTime(hoverTime)}
							</div>
						)}

						{/* Background Track with Buffer Line */}
						<div className="w-full relative h-1.5 flex items-center">
							{/* Buffered progress line */}
							<div
								className="absolute left-0 top-0 bottom-0 bg-white/20 rounded-full transition-all pointer-events-none"
								style={{ width: `${buffered}%` }}
							/>
							<Slider
								value={[currentTime]}
								min={0}
								max={duration || 1}
								step={0.1}
								onValueChange={handleSeek}
								className="w-full cursor-pointer"
								trackClassName="bg-white/25"
								thumbClassName="h-3.5 w-3.5 bg-white border-none shadow-md rounded-full ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
							/>
						</div>
					</div>

					{/* Control Buttons Row */}
					<div className="flex items-center justify-between gap-3 text-white">
						{/* Left: Play/Pause, Volume, Time */}
						<div className="flex items-center gap-3">
							{/* Play/Pause Toggle */}
							<button
								type="button"
								onClick={togglePlay}
								className="text-white/90 hover:text-white hover:scale-110 active:scale-95 transition cursor-pointer p-1"
								title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
							>
								{isPlaying ? (
									<Pause size={20} fill="currentColor" />
								) : (
									<Play size={20} fill="currentColor" />
								)}
							</button>

							{/* Volume Control (Horizontal Slider showing properly without artifacts) */}
							<div
								className="relative flex items-center gap-2 shrink-0 group/vol"
								onMouseEnter={() => setIsVolumeHovered(true)}
								onMouseLeave={() => setIsVolumeHovered(false)}
							>
								<button
									type="button"
									onClick={toggleMute}
									className="text-white/90 hover:text-white hover:scale-110 active:scale-95 transition cursor-pointer p-1 shrink-0"
									title={isMuted || volume === 0 ? 'Unmute (m)' : 'Mute (m)'}
								>
									{isMuted || volume === 0 ? (
										<VolumeX size={20} className="text-destructive" />
									) : volume < 0.5 ? (
										<Volume1 size={20} />
									) : (
										<Volume2 size={20} />
									)}
								</button>

								{/* Volume Slider - clean circular thumb with zero square box artifacts */}
								<div className={`transition-all duration-150 flex items-center py-1 ${isVolumeHovered ? 'w-24 opacity-100' : 'w-20 opacity-90'}`}>
									<Slider
										value={[isMuted ? 0 : volume]}
										min={0}
										max={1}
										step={0.01}
										onValueChange={handleVolumeChange}
										className="w-full cursor-pointer"
										trackClassName="bg-white/25"
										thumbClassName="h-3.5 w-3.5 bg-white border-none shadow-md rounded-full ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
									/>
								</div>
								<span className="text-[10px] font-semibold tabular-nums text-white/70 w-8 shrink-0 text-left">
									{Math.round((isMuted ? 0 : volume) * 100)}%
								</span>
							</div>

							{/* Time Display */}
							<span className="text-[12px] font-medium text-white/80 tabular-nums">
								{formatTime(currentTime)} / {formatTime(duration)}
							</span>
						</div>

						{/* Right: Speed (Fixed-width 1.0x, 2.0x like Voice Player) & Fullscreen */}
						<div className="flex items-center gap-2">
							{/* Speed Control (Vertical Slider matching Voice Player with fixed width) */}
							<div
								ref={speedMenuRef}
								className="relative flex items-center shrink-0"
								onMouseEnter={() => setShowSpeedSlider(true)}
								onMouseLeave={() => {
									if (!isDraggingSpeedRef.current) setShowSpeedSlider(false);
								}}
							>
								<button
									type="button"
									onClick={() => setShowSpeedSlider((prev) => !prev)}
									className="flex items-center justify-center w-12 h-7 rounded-md hover:bg-white/15 transition-colors cursor-pointer text-white"
									title="Playback speed"
								>
									<span className="text-xs font-bold font-mono tabular-nums text-primary">
										{playbackRate.toFixed(1)}x
									</span>
								</button>

								{/* Vertical Slider Panel matching Voice Player */}
								{showSpeedSlider && (
									<div
										className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 z-50 animate-in fade-in zoom-in-95 duration-150"
										onClick={(e) => e.stopPropagation()}
										onPointerDown={(e) => {
											e.stopPropagation();
											isDraggingSpeedRef.current = true;
										}}
									>
										<div className="bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl p-3 flex flex-col items-center gap-2 min-h-[140px] w-12 text-foreground">
											<div className="h-24 flex items-center justify-center">
												<Slider
													orientation="vertical"
													min={0.5}
													max={3}
													step={0.1}
													value={[playbackRate]}
													onValueChange={([val]) => handleRateChange(Math.round(val * 10) / 10)}
													className="h-full"
													trackClassName="bg-white/20"
													thumbClassName="h-3.5 w-3.5 bg-primary border-none shadow-sm rounded-full"
												/>
											</div>
											<span className="text-[10px] font-bold font-mono tabular-nums text-primary">
												{playbackRate.toFixed(1)}x
											</span>
										</div>
									</div>
								)}
							</div>

							{/* Native Fullscreen Toggle */}
							<button
								type="button"
								onClick={toggleFullscreen}
								className="text-white/80 hover:text-white hover:scale-110 active:scale-95 transition cursor-pointer p-1"
								title={isFullscreen ? 'Exit Fullscreen (f)' : 'Fullscreen (f)'}
							>
								{isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
