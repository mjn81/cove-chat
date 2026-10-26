import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import type { WhisperMessageFile } from '@/store/whisperStore';

interface WhisperVoiceBubbleProps {
	file: WhisperMessageFile;
}

export const WhisperVoiceBubble: React.FC<WhisperVoiceBubbleProps> = ({ file }) => {
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(file.duration || 0);

	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const onTimeUpdate = () => setCurrentTime(audio.currentTime);
		const onLoadedMetadata = () => {
			if (audio.duration && isFinite(audio.duration)) {
				setDuration(audio.duration);
			}
		};
		const onEnded = () => {
			setIsPlaying(false);
			setCurrentTime(0);
		};

		audio.addEventListener('timeupdate', onTimeUpdate);
		audio.addEventListener('loadedmetadata', onLoadedMetadata);
		audio.addEventListener('ended', onEnded);

		return () => {
			audio.removeEventListener('timeupdate', onTimeUpdate);
			audio.removeEventListener('loadedmetadata', onLoadedMetadata);
			audio.removeEventListener('ended', onEnded);
		};
	}, []);

	const togglePlay = (e: React.MouseEvent) => {
		e.stopPropagation();
		const audio = audioRef.current;
		if (!audio) return;

		if (isPlaying) {
			audio.pause();
			setIsPlaying(false);
		} else {
			audio.play().then(() => setIsPlaying(true)).catch((err) => {
				console.warn('Failed to play whisper audio:', err);
			});
		}
	};

	const formatTime = (s: number) => {
		if (!isFinite(s) || isNaN(s)) return '0:00';
		return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	};

	const progress = duration > 0 ? currentTime / duration : 0;
	const waveform = file.waveform && file.waveform.length > 0
		? file.waveform
		: Array.from({ length: 28 }, (_, i) => 20 + Math.sin(i * 0.5) * 15);

	const handleDownload = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!file.blobUrl) return;
		const a = document.createElement('a');
		a.href = file.blobUrl;
		a.download = file.name || 'voice-message.ogg';
		a.click();
	};

	return (
		<div className="flex flex-col select-none" onClick={(e) => e.stopPropagation()}>
			{file.blobUrl && <audio ref={audioRef} src={file.blobUrl} preload="metadata" />}
			<div className="mt-2 flex items-center gap-3 bg-secondary/80 border border-border p-3 rounded-2xl w-full max-w-[320px] shadow-xs hover:bg-secondary transition-colors cursor-default">
				{/* Play / Pause button */}
				<button
					type="button"
					onClick={togglePlay}
					disabled={!file.blobUrl}
					className="w-10 h-10 flex items-center justify-center bg-primary text-primary-foreground rounded-full hover:scale-105 transition active:scale-95 shrink-0 cursor-pointer disabled:opacity-50"
					title={isPlaying ? 'Pause' : 'Play'}
				>
					{isPlaying ? (
						<Pause size={20} fill="currentColor" />
					) : (
						<Play size={20} fill="currentColor" className="ms-0.5" />
					)}
				</button>

				{/* Waveform Visualization */}
				<div className="flex flex-col flex-1 min-w-0 gap-1.5">
					<div className="flex items-end gap-[1.5px] h-8 px-1">
						{waveform.map((peak, i) => {
							const barProgress = i / waveform.length;
							const isPlayed = progress > barProgress;
							return (
								<div
									key={i}
									className={`flex-1 rounded-full transition-colors duration-75 ${
										isPlayed ? 'bg-primary' : 'bg-muted-foreground/30'
									}`}
									style={{ height: `${Math.max(15, peak)}%` }}
								/>
							);
						})}
					</div>

					{/* Time + Download */}
					<div className="flex justify-between items-center px-0.5">
						<span className="text-[10px] font-medium text-muted-foreground tabular-nums">
							{currentTime > 0 ? formatTime(currentTime) : formatTime(duration)}
						</span>
						<button
							type="button"
							onClick={handleDownload}
							className="text-muted-foreground hover:text-foreground transition p-0.5 cursor-pointer"
							title="Download Voice Note"
						>
							<Download size={14} />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
