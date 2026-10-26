import { useTranslation } from 'react-i18next';
import { Loader2, Mic, Pause, Play, RotateCcw, Scissors, Send, Trash2 } from 'lucide-react';

import { TrimTimeline } from '@/components/trim-timeline';
import { useVoiceRecorder } from '../hooks/use-voice-recorder';
import { isTrimmed } from '@/utils/trim';
import { formatDuration } from '../utils/recording';

interface VoiceRecorderProps {
	channelId: string;
	/** Receives the file when no direct-send handler is given. */
	onFile: (file: File) => void;
	/** Sends the finished voice note immediately. */
	onSendVoice?: (file: File, duration?: number) => Promise<void>;
	/** Icon size of the idle microphone button. */
	size?: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Voice-note recorder for the composer. Idle it is a microphone button;
 * while recording it covers the composer with a live level meter; after
 * "pause" it becomes a preview with waveform trimming before sending.
 */
export default function VoiceRecorder({ onFile, onSendVoice, size = 20 }: VoiceRecorderProps) {
	const { t } = useTranslation();
	const { timelineRef, ...r } = useVoiceRecorder({ onFile, onSendVoice });

	if (r.mode === 'idle') {
		return (
			<button
				type="button"
				onClick={r.start}
				className="group flex cursor-pointer items-center justify-center rounded-full p-1 text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground"
				title={t('chat.record_voice')}
				aria-label={t('chat.record_voice')}
			>
				<Mic size={size} className="transition-transform group-hover:scale-110" />
			</button>
		);
	}

	if (r.mode === 'recording') {
		return (
			<div className="absolute inset-0 z-30 flex select-none items-center justify-between rounded-lg border border-primary/30 bg-secondary px-3 py-1.5 animate-in fade-in duration-200">
				<div className="flex shrink-0 items-center gap-2.5 ps-1">
					<span className="relative flex h-3 w-3">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
						<span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
					</span>
					<span dir="ltr" className="font-mono text-xs font-bold tabular-nums tracking-wide text-foreground">
						{formatDuration(r.duration)}
					</span>
				</div>

				<div dir="ltr" className="flex h-7 flex-1 items-center justify-center gap-[3px] overflow-hidden px-4">
					{r.liveLevels.map((level, idx) => (
						<div
							key={idx}
							className="w-1 rounded-full bg-primary transition-all duration-75"
							style={{ height: `${level}%` }}
						/>
					))}
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={r.discard}
						className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
						title={t('chat.discard_recording')}
						aria-label={t('chat.discard_recording')}
					>
						<Trash2 size={17} />
					</button>
					<button
						type="button"
						onClick={r.pauseAndReview}
						className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
						title={t('chat.pause_recording')}
						aria-label={t('chat.pause_recording')}
					>
						<Pause size={17} />
					</button>
					<button
						type="button"
						onClick={r.quickSend}
						disabled={r.isSending}
						className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105 hover:bg-primary/90 active:scale-95"
						title={t('chat.send_voice')}
						aria-label={t('chat.send_voice')}
					>
						{r.isSending ? (
							<Loader2 size={15} className="animate-spin" />
						) : (
							<Send size={14} className="-ms-0.5 rtl:-scale-x-100" />
						)}
					</button>
				</div>
			</div>
		);
	}

	// Preview & trim
	const startRatio = clamp01(r.trimStart / r.totalDuration);
	const endRatio = clamp01(r.trimEnd / r.totalDuration);
	const playheadRatio = clamp01(r.previewCurrentTime / r.totalDuration);
	const modified = isTrimmed(r.totalDuration, r.trimStart, r.trimEnd);

	return (
		<div className="absolute inset-0 z-30 flex select-none items-center gap-3 rounded-lg border border-border bg-secondary px-3 py-1.5 animate-in fade-in duration-200">
			<button
				type="button"
				onClick={r.togglePreviewPlay}
				className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105 active:scale-95"
				title={r.isPlayingPreview ? t('voice.pause') : t('voice.play_preview')}
				aria-label={r.isPlayingPreview ? t('voice.pause') : t('voice.play_preview')}
			>
				{r.isPlayingPreview ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
			</button>

			<div dir="ltr" className="flex shrink-0 flex-col text-start">
				<span className="font-mono text-xs font-bold leading-none tabular-nums text-foreground">
					{formatDuration(Math.max(0, r.trimEnd - r.trimStart))}
				</span>
				<span className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
					{formatDuration(r.previewCurrentTime)}
				</span>
			</div>

			<TrimTimeline
				className="flex-1"
				bars={r.waveformPeaks}
				startRatio={startRatio}
				endRatio={endRatio}
				playheadRatio={playheadRatio}
				timelineRef={timelineRef}
				onBeginDrag={r.beginDrag}
				onPointerMove={r.onPointerMove}
				onPointerUp={r.onPointerUp}
				onSeek={r.seekTo}
				startHandleLabel={t('voice.trim_start')}
				endHandleLabel={t('voice.trim_end')}
			/>

			{modified && (
				<button
					type="button"
					onClick={r.resetTrim}
					className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
					title={t('chat.reset_trim')}
					aria-label={t('chat.reset_trim')}
				>
					<RotateCcw size={15} />
				</button>
			)}

			<div className="flex shrink-0 items-center gap-1.5">
				<button
					type="button"
					onClick={r.discard}
					disabled={r.isSending}
					className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
					title={t('chat.discard_recording')}
					aria-label={t('chat.discard_recording')}
				>
					<Trash2 size={17} />
				</button>
				<button
					type="button"
					onClick={r.send}
					disabled={r.isSending}
					className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:scale-105 hover:bg-primary/90 active:scale-95"
					title={t('chat.send_voice')}
				>
					{r.isSending ? (
						<>
							<Loader2 size={13} className="animate-spin" />
							<span>{t('voice.sending')}</span>
						</>
					) : (
						<>
							{modified && <Scissors size={12} />}
							<span>{t('chat.send')}</span>
						</>
					)}
				</button>
			</div>
		</div>
	);
}
