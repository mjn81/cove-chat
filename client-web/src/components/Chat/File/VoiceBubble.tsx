import React from 'react';
import { Play, Pause, Loader2, Download } from 'lucide-react';
import { voicePlayer } from '@/lib/voicePlayer';
import { useVoicePlayer } from '@/hooks/useVoicePlayer';

interface FileMetadata {
	file_id: string;
	name?: string;
	mime: string;
	size: number;
	duration?: number;
	nonce: string;
	thumb_ciphertext?: string;
	thumb_nonce?: string;
}

interface VoiceBubbleProps {
	meta: FileMetadata;
	channelId: string;
	waveform: number[] | null;
	handleDownload: () => void;
}

export const VoiceBubble: React.FC<VoiceBubbleProps> = ({
	meta,
	channelId,
	waveform,
	handleDownload,
}) => {
	const { track, isPlaying, isLoading, currentTime, duration } =
		useVoicePlayer();

	const isActive = track?.fileId === meta.file_id;
	const thisPlaying = isActive && isPlaying;
	const thisLoading = isActive && isLoading;
	const progress = isActive && duration > 0 ? currentTime / duration : 0;

	const formatTime = (s: number) => {
		if (!isFinite(s) || isNaN(s)) return '0:00';
		return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	};

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();

		if (isActive) {
			// Same track: toggle pause/resume
			voicePlayer.togglePlay();
		} else {
			// Different track: load and play
			voicePlayer.play({
				fileId: meta.file_id,
				channelId,
				mime: meta.mime,
				nonce: meta.nonce,
				waveform,
				label: meta.name,
			});
		}
	};

	const displayDuration =
		isActive && duration > 0 ? duration : meta.duration || 0;

	return (
		<div
			className="flex flex-col select-none"
			onClick={(e) => e.stopPropagation()}
		>
			<div className="mt-2 flex items-center gap-3 bg-secondary/80 border border-border p-3 rounded-2xl w-full max-w-[320px] shadow-sm hover:bg-secondary transition-colors cursor-default">
				{/* Play / Pause button */}
				<button
					onClick={handleClick}
					disabled={thisLoading}
					className="w-10 h-10 flex items-center justify-center bg-primary text-primary-foreground rounded-full hover:scale-105 transition active:scale-95 shrink-0"
				>
					{thisLoading ? (
						<Loader2 size={20} className="animate-spin" />
					) : thisPlaying ? (
						<Pause size={20} fill="currentColor" />
					) : (
						<Play size={20} fill="currentColor" />
					)}
				</button>

				{/* Waveform (progress-only, no seek) */}
				<div className="flex flex-col flex-1 min-w-0 gap-1.5">
					<div className="flex items-end gap-[1.5px] h-8 px-1">
						{waveform ? (
							waveform.map((peak, i) => {
								const barProgress = i / waveform.length;
								const isPlayed = isActive && progress > barProgress;
								return (
									<div
										key={i}
										className={`flex-1 rounded-full transition-colors duration-75 ${
											isPlayed ? 'bg-primary' : 'bg-muted-foreground/30'
										}`}
										style={{ height: `${Math.max(15, peak)}%` }}
									/>
								);
							})
						) : (
							<div className="w-full h-1 bg-muted-foreground/20 rounded-full animate-pulse" />
						)}
					</div>

					{/* Time + download */}
					<div className="flex justify-between items-center px-0.5">
						<span className="text-[10px] font-medium text-muted-foreground tabular-nums">
							{isActive && currentTime > 0
								? formatTime(currentTime)
								: formatTime(displayDuration)}
						</span>
						<button
							onClick={(e) => {
								e.stopPropagation();
								handleDownload();
							}}
							className="text-muted-foreground hover:text-foreground transition p-0.5"
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
