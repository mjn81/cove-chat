import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FlipHorizontal, Loader2, Play, RotateCcw, Scissors, Send, Square, X } from 'lucide-react';

import { TrimTimeline } from '@/components/trim-timeline';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/icon-button';
import { cn } from '@/lib/utils';
import { useVideoRecorder } from '../hooks/use-video-recorder';
import { MAX_VIDEO_SECONDS, formatSecondsCeil, progressRing } from '../utils/video-recording';

interface VideoMessageRecorderModalProps {
	open: boolean;
	onClose: () => void;
	onSend: (file: File) => void;
}

/** Round, hardware-clipped frame shared by the live camera and the preview video. */
const FRAME_CLIP_STYLE: React.CSSProperties = {
	WebkitMaskImage: '-webkit-radial-gradient(white, black)',
	maskImage: 'radial-gradient(white, black)',
	transform: 'translateZ(0)',
	isolation: 'isolate',
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Neutral tick heights for the video trim bar (video has no waveform). */
const TICK_BARS = Array.from({ length: 40 }, () => 60);

/**
 * Full-screen "video message" recorder: a squircle camera preview with a
 * countdown ring, a 60 s limit and a preview step where the clip can be
 * trimmed before it is sent.
 */
export const VideoMessageRecorderModal: React.FC<VideoMessageRecorderModalProps> = ({
	open,
	onClose,
	onSend,
}) => {
	const { t } = useTranslation();
	const { timelineRef, liveVideoRef, previewVideoRef, ...r } = useVideoRecorder({ open, onClose, onSend });
	const ring = progressRing(r.timeLeft);
	const total = r.recordedDuration || MAX_VIDEO_SECONDS;

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			{/* The built-in close button is hidden ([&>button:last-child]:hidden) so only the one aligned with the squircle remains. */}
			<DialogContent className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-[360px] -translate-x-1/2 -translate-y-1/2 select-none flex-col items-center justify-center border-none bg-transparent p-0 shadow-none outline-none sm:max-w-[420px] [&>button:last-child]:hidden">
				<DialogTitle className="sr-only">{t('videoRecorder.title')}</DialogTitle>

				<div className="pointer-events-auto mb-2 flex w-[min(20rem,calc(100vw-1.5rem))] justify-end sm:w-96">
					<IconButton label={t('common.close')} tone="overlay" size="md" onClick={onClose} className="rounded-full">
						<X size={18} />
					</IconButton>
				</div>

				<div
					className="group relative flex aspect-square w-[min(20rem,calc(100vw-1.5rem))] items-center justify-center overflow-hidden rounded-[40px] border-2 border-overlay-foreground/15 bg-overlay sm:w-96 sm:rounded-[48px]"
					style={FRAME_CLIP_STYLE}
				>
					{r.mode !== 'preview' && (
						<video
							ref={liveVideoRef}
							autoPlay
							muted
							playsInline
							className="h-full w-full rounded-[40px] object-cover sm:rounded-[48px]"
							// Mirrored like a selfie camera.
							style={{ transform: 'scaleX(-1) translateZ(0)', WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}
						/>
					)}

					{r.mode === 'preview' && r.recordedUrl && (
						<video
							ref={previewVideoRef}
							src={r.recordedUrl}
							autoPlay
							playsInline
							loop
							onTimeUpdate={r.onPreviewTimeUpdate}
							onPlay={() => r.setPreviewPlaying(true)}
							onPause={() => r.setPreviewPlaying(false)}
							onClick={r.togglePreviewPlay}
							className="h-full w-full cursor-pointer rounded-[40px] object-cover sm:rounded-[48px]"
							style={{ transform: 'translateZ(0)', WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}
						/>
					)}

					{r.mode === 'recording' && (
						<svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${ring.size} ${ring.size}`}>
							<rect
								x={ring.inset}
								y={ring.inset}
								width={ring.innerSize}
								height={ring.innerSize}
								rx={ring.radius}
								ry={ring.radius}
								fill="none"
								className="stroke-overlay-foreground/15"
								strokeWidth="6"
							/>
							<rect
								x={ring.inset}
								y={ring.inset}
								width={ring.innerSize}
								height={ring.innerSize}
								rx={ring.radius}
								ry={ring.radius}
								fill="none"
								strokeWidth="6"
								strokeDasharray={ring.perimeter}
								strokeDashoffset={ring.dashOffset}
								strokeLinecap="round"
								className="stroke-primary transition-all duration-100"
							/>
						</svg>
					)}

					{r.mode === 'recording' && (
						<div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-overlay-foreground/10 bg-overlay/70 px-3 py-1 font-mono text-xs font-bold text-overlay-foreground backdrop-blur-md animate-in fade-in duration-200">
							<span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
							<span dir="ltr">{t('videoRecorder.time_left', { time: formatSecondsCeil(r.timeLeft) })}</span>
						</div>
					)}

					{r.mode === 'idle' && r.videoDevices.length > 1 && (
						<IconButton
							label={t('videoRecorder.switch_camera')}
							tone="overlay"
							onClick={r.toggleCamera}
							className="absolute end-3 top-3 rounded-full"
						>
							<FlipHorizontal size={16} />
						</IconButton>
					)}

					{r.hasPermission === false && (
						<div className="absolute inset-0 flex flex-col items-center justify-center bg-overlay/80 p-6 text-center text-destructive">
							<AlertCircle size={32} className="mb-2" />
							<span className="text-xs font-semibold">{t('videoRecorder.denied')}</span>
							<p className="mt-1 text-[11px] text-overlay-foreground/70">
								{r.permissionError || t('videoRecorder.allow')}
							</p>
						</div>
					)}

					{r.mode === 'preview' && !r.previewPlaying && (
						<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-overlay/30">
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 text-primary-foreground">
								<Play size={22} fill="currentColor" className="ms-0.5 rtl:-scale-x-100" />
							</div>
						</div>
					)}
				</div>

				<div className="mt-4 flex w-full max-w-80 flex-col items-center gap-3 sm:max-w-96">
					{r.mode === 'idle' && (
						<div className="flex flex-col items-center gap-2">
							<button
								type="button"
								onClick={r.startRecording}
								disabled={r.hasPermission === false}
								className="group flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-destructive text-destructive-foreground transition hover:bg-destructive/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
								title={t('videoRecorder.start')}
								aria-label={t('videoRecorder.start')}
							>
								<div className="h-6 w-6 rounded-full bg-destructive-foreground transition-transform group-hover:scale-110" />
							</button>
							<span className="text-xs font-medium text-overlay-foreground/80">
								{t('videoRecorder.tap_to_start', { max: MAX_VIDEO_SECONDS })}
							</span>
						</div>
					)}

					{r.mode === 'recording' && (
						<div className="flex flex-col items-center gap-2">
							<button
								type="button"
								onClick={r.stopRecording}
								className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-destructive text-destructive-foreground transition hover:bg-destructive/90 active:scale-95"
								title={t('videoRecorder.stop')}
								aria-label={t('videoRecorder.stop')}
							>
								<Square size={24} fill="currentColor" />
							</button>
							<span className="animate-pulse text-xs font-medium text-destructive">{t('videoRecorder.recording')}</span>
						</div>
					)}

					{r.mode === 'preview' && (
						<div className="flex w-full flex-col gap-3 rounded-2xl border border-overlay-foreground/10 bg-overlay/70 p-3 text-overlay-foreground backdrop-blur-xl">
							<div className="flex flex-col gap-1.5 px-1">
								<div className="flex items-center justify-between text-[11px] font-medium text-overlay-foreground/70">
									<span className="flex items-center gap-1">
										<Scissors size={12} className="text-primary" />
										<span>{t('videoRecorder.trim')}</span>
									</span>
									<span dir="ltr" className="font-mono text-overlay-foreground/90">
										{formatSecondsCeil(r.trimStart)} - {formatSecondsCeil(r.trimEnd)} (
										{Math.max(1, Math.round(r.trimEnd - r.trimStart))}s)
									</span>
								</div>
								<TrimTimeline
									bars={TICK_BARS}
									startRatio={clamp01(r.trimStart / total)}
									endRatio={clamp01(r.trimEnd / total)}
									playheadRatio={clamp01(r.previewCurrentTime / total)}
									timelineRef={timelineRef}
									onBeginDrag={r.beginDrag}
									onPointerMove={r.onPointerMove}
									onPointerUp={r.onPointerUp}
									onSeek={r.seekTo}
									startHandleLabel={t('voice.trim_start')}
									endHandleLabel={t('voice.trim_end')}
								/>
							</div>

							<div className="flex items-center justify-between gap-2 border-t border-overlay-foreground/10 pt-1">
								<button
									type="button"
									onClick={r.retake}
									disabled={r.isBusy}
									className={cn(
										'flex cursor-pointer items-center gap-1.5 rounded-xl bg-overlay-foreground/10 px-3 py-1.5 text-xs font-medium transition hover:bg-overlay-foreground/15',
									)}
								>
									<RotateCcw size={14} />
									<span>{t('videoRecorder.retake')}</span>
								</button>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={onClose}
										disabled={r.isBusy}
										className="cursor-pointer rounded-xl px-3 py-1.5 text-xs font-medium text-overlay-foreground/70 transition hover:text-overlay-foreground"
									>
										{t('common.cancel')}
									</button>
									<button
										type="button"
										onClick={r.send}
										disabled={r.isBusy}
										className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
									>
										{r.isBusy ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<Send size={14} className="rtl:-scale-x-100" />
										)}
										<span>{t('chat.send')}</span>
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
