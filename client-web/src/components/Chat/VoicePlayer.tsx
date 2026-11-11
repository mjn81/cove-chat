// guardrail-allow physicalClass: media timelines, scrubbers and waveforms run left-to-right in RTL UIs too.
import React, { useRef, useState, useEffect } from 'react';
import {
	Play,
	Pause,
	X,
	Loader2,
	Volume2,
	Volume1,
	VolumeX,
	Repeat,
	Repeat1,
	ListMusic,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVoicePlayer, useVoicePlayerActions } from '@/hooks/useVoicePlayer';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export const VoicePlayer: React.FC = () => {
	const { t } = useTranslation();
	const { track, isPlaying, isLoading, currentTime, duration, speed, volume, repeatMode, queue } =
		useVoicePlayer();
	const { play, togglePlay, seek, setSpeed, setVolume, cycleRepeat, close } =
		useVoicePlayerActions();
	const [isScrubbing, setIsScrubbing] = useState(false);
	const [scrubTime, setScrubTime] = useState(0);
	const [showSpeedSlider, setShowSpeedSlider] = useState(false);
	const [showVolumeSlider, setShowVolumeSlider] = useState(false);
	const [showPlaylist, setShowPlaylist] = useState(false);

	const isDraggingSpeedRef = useRef(false);
	const isDraggingVolumeRef = useRef(false);
	const speedRef = useRef<HTMLDivElement>(null);
	const volumeRef = useRef<HTMLDivElement>(null);

	// Ensure dragging anywhere never drops drag state prematurely
	useEffect(() => {
		const handlePointerUp = () => {
			isDraggingSpeedRef.current = false;
			isDraggingVolumeRef.current = false;
		};
		window.addEventListener('pointerup', handlePointerUp);
		return () => window.removeEventListener('pointerup', handlePointerUp);
	}, []);

	// Click outside listener for slider panels
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
				setShowSpeedSlider(false);
			}
			if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
				setShowVolumeSlider(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	if (!track) return null;

	const formatTime = (s: number) => {
		if (!isFinite(s) || isNaN(s)) return '0:00';
		return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	};

	const displayTime = isScrubbing ? scrubTime : currentTime;

	return (
		<div
			key={track.fileId}
			className="absolute top-[48px] left-0 right-0 z-20 flex items-center gap-2 px-3 py-2 border-b border-border bg-background/95 backdrop-blur-md animate-in slide-in-from-top-1 duration-200 select-none"
		>
			{/* Play / Pause */}
			<button
				onClick={togglePlay}
				disabled={isLoading}
				className="w-9 h-9 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition shrink-0"
				title={isPlaying ? 'Pause' : 'Play'}
			>
				{isLoading ? (
					<Loader2 size={16} className="animate-spin" />
				) : isPlaying ? (
					<Pause size={16} fill="currentColor" />
				) : (
					<Play size={16} fill="currentColor" />
				)}
			</button>

			{/* Title and time, like Telegram's audio bar: who sent it, then where playback is */}
			<div className="min-w-0 flex-1 leading-tight">
				<div className="truncate text-sm font-semibold text-foreground">
					{/* Recorded notes are all named voice-message.*, which says nothing; real music files keep their name. */}
					{track.label && !/^voice-message/i.test(track.label) ? track.label : t('chat.voice_message')}
				</div>
				<div className="text-xs tabular-nums text-muted-foreground">
					{formatTime(displayTime)} / {formatTime(duration)}
				</div>
			</div>

			{/* Progress runs along the whole bottom edge of the bar, so it keeps its length however many controls sit above it */}
			<div className="group absolute inset-x-0 -bottom-px flex h-3 items-end">
				<Slider
					value={[isScrubbing ? scrubTime : currentTime]}
					min={0}
					max={duration > 0 ? duration : 1}
					step={0.05}
					onValueChange={([val]) => {
						setIsScrubbing(true);
						setScrubTime(val);
					}}
					onValueCommit={([val]) => {
						setIsScrubbing(false);
						seek(duration > 0 ? val / duration : 0);
					}}
					className="w-full cursor-pointer select-none"
					trackClassName="h-0.5 rounded-none bg-muted group-hover:h-1 transition-all"
					rangeClassName="bg-primary rounded-none"
					thumbClassName={cn(
						'h-3 w-3 bg-primary border-none shadow-sm rounded-full transition-opacity ring-0 focus-visible:ring-0 focus-visible:ring-offset-0',
						isScrubbing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
					)}
				/>
			</div>

			{/* Speed Control (Vertical Slider with fixed-width 1.0x, 2.0x) */}
			<div
				ref={speedRef}
				className="relative flex items-center shrink-0"
				onMouseEnter={() => setShowSpeedSlider(true)}
				onMouseLeave={() => {
					if (!isDraggingSpeedRef.current) setShowSpeedSlider(false);
				}}
			>
				<button
					type="button"
					onClick={() => setShowSpeedSlider((v) => !v)}
					className="flex items-center justify-center w-12 h-7 rounded-md hover:bg-muted transition-colors cursor-pointer shrink-0"
					title={t('chat.playback_speed')}
				>
					<span className="text-xs font-bold font-mono tabular-nums text-primary">
						{speed.toFixed(1)}x
					</span>
				</button>

				{/* Vertical Slider Panel */}
				{showSpeedSlider && (
					<div
						className="absolute top-full left-1/2 -translate-x-1/2 pt-2 z-50 animate-in fade-in zoom-in-95 duration-150"
						onClick={(e) => e.stopPropagation()}
						onPointerDown={(e) => {
							e.stopPropagation();
							isDraggingSpeedRef.current = true;
						}}
					>
						<div className="bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl p-3 flex flex-col items-center gap-2 min-h-[140px] w-12">
							<div className="h-24 flex items-center justify-center">
								<Slider
									orientation="vertical"
									min={0.5}
									max={3}
									step={0.1}
									value={[speed]}
									onValueChange={([val]) => setSpeed(Math.round(val * 10) / 10)}
									className="h-full"
									trackClassName="bg-white/20"
									thumbClassName="h-3.5 w-3.5 bg-primary border-none shadow-sm rounded-full"
								/>
							</div>
							<span className="text-[10px] font-bold font-mono tabular-nums text-primary">
								{speed.toFixed(1)}x
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Volume Control (Vertical Slider matching Speed dial UI) */}
			<div
				ref={volumeRef}
				className="relative flex items-center shrink-0"
				onMouseEnter={() => setShowVolumeSlider(true)}
				onMouseLeave={() => {
					if (!isDraggingVolumeRef.current) setShowVolumeSlider(false);
				}}
			>
				<button
					type="button"
					onClick={() => setVolume(volume > 0 ? 0 : 1)}
					className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted transition-colors cursor-pointer"
					title={volume === 0 ? 'Unmute' : 'Mute'}
				>
					{volume === 0 ? (
						<VolumeX size={16} className="text-muted-foreground" />
					) : volume < 0.5 ? (
						<Volume1 size={16} className="text-primary" />
					) : (
						<Volume2 size={16} className="text-primary" />
					)}
				</button>

				{/* Vertical Volume Slider Panel */}
				{showVolumeSlider && (
					<div
						className="absolute top-full left-1/2 -translate-x-1/2 pt-2 z-50 animate-in fade-in zoom-in-95 duration-150"
						onClick={(e) => e.stopPropagation()}
						onPointerDown={(e) => {
							e.stopPropagation();
							isDraggingVolumeRef.current = true;
						}}
					>
						<div className="bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl p-3 flex flex-col items-center gap-2 min-h-[135px] w-12">
							<div className="h-24 flex items-center justify-center">
								<Slider
									orientation="vertical"
									min={0}
									max={1}
									step={0.01}
									value={[volume]}
									onValueChange={([val]) => setVolume(val)}
									className="h-full"
									trackClassName="bg-white/20"
									thumbClassName="h-3.5 w-3.5 bg-primary border-none shadow-sm rounded-full"
								/>
							</div>
							<span className="text-[9px] font-semibold tabular-nums text-muted-foreground">
								{Math.round(volume * 100)}%
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Repeat Mode Toggle (None -> Once -> Loop) */}
			<button
				type="button"
				onClick={cycleRepeat}
				className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer shrink-0 ${
					repeatMode !== 'none'
						? 'text-primary bg-primary/15'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted'
				}`}
				title={
					repeatMode === 'once'
						? 'Repeat: Once'
						: repeatMode === 'all'
						? 'Repeat: Loop'
						: 'Repeat: Off'
				}
			>
				{repeatMode === 'once' ? <Repeat1 size={15} /> : <Repeat size={15} />}
			</button>

			{/* Playlist: every voice note and audio file in this chat, current one highlighted */}
			{queue.length > 1 && (
				<button
					type="button"
					onClick={() => setShowPlaylist((v) => !v)}
					className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer shrink-0 ${
						showPlaylist ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
					}`}
					title={t('chat.playlist')}
					aria-label={t('chat.playlist')}
				>
					<ListMusic size={16} />
				</button>
			)}

			{showPlaylist && queue.length > 1 && (
				<div className="absolute right-2 top-full z-50 mt-1 max-h-64 w-72 max-w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md animate-in fade-in zoom-in-95 duration-150">
					{queue.map((item) => {
						const current = item.fileId === track.fileId;
						return (
							<button
								key={item.fileId}
								type="button"
								onClick={() => (current ? togglePlay() : play(item))}
								className={cn(
									'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-accent',
									current && 'bg-primary/10 text-primary',
								)}
							>
								<span className="flex h-6 w-6 shrink-0 items-center justify-center">
									{current && isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
								</span>
								<span className="min-w-0 flex-1 truncate">{item.label || t('chat.voice_message')}</span>
							</button>
						);
					})}
				</div>
			)}

			{/* Close */}
			<button
				type="button"
				onClick={close}
				className="text-muted-foreground hover:text-foreground transition shrink-0 p-1"
				title={t('chat.close_player')}
			>
				<X size={14} />
			</button>
		</div>
	);
};
