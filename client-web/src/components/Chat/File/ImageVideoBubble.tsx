import React, { useState } from 'react';
import {
	ImageIcon,
	Film,
	Loader2,
	Expand,
	Download,
	ArrowDown,
	Play,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/icon-button';
import { MediaViewer } from '@/components/media-viewer';
import { CustomVideoPlayer } from './CustomVideoPlayer';

interface ImageVideoBubbleProps {
	meta: any;
	thumbUrl: string | null;
	fullUrl: string | null;
	isDecrypting: boolean;
	progress: number;
	handleDownload: (e?: React.MouseEvent) => void;
	handleFullscreen: (e: React.MouseEvent) => void;
}

export const ImageVideoBubble: React.FC<ImageVideoBubbleProps> = ({
	meta,
	thumbUrl,
	fullUrl,
	isDecrypting,
	progress,
	handleDownload,
	handleFullscreen,
}) => {
	const { t } = useTranslation();
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

	const isVideo = meta.mime.startsWith('video/');
	const isImage = meta.mime.startsWith('image/');

	// An image/video is opened when full content has been decrypted/loaded
	const isOpened = Boolean(fullUrl);

	const handleReveal = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!fullUrl && !isDecrypting) {
			handleFullscreen(e);
		}
	};

	return (
		<>
			<div
				className="relative rounded-lg overflow-hidden bg-secondary border border-border cursor-pointer hover:border-primary transition group select-none max-w-[400px]"
				onClick={(e) => {
					if (!isOpened) {
						handleReveal(e);
					} else {
						setIsFullscreenOpen(true);
						if (!fullUrl) handleFullscreen(e);
					}
				}}
			>
				{/* Top-left compact size badge when unopened */}
				{meta.size > 0 && !isOpened && (
					<span className="absolute top-2 start-2 z-20 pointer-events-none inline-flex items-center justify-center h-5 px-1.5 rounded text-[10px] font-medium leading-none text-overlay-foreground/90 bg-overlay/60 backdrop-blur-sm shadow-sm tabular-nums">
						{(meta.size / 1024).toFixed(0)} KB
					</span>
				)}

				{/* Media element: blurred when unopened, crisp and clean frame overview when opened */}
				<div className="relative overflow-hidden w-full max-h-[350px] flex items-center justify-center bg-overlay/20">
					{thumbUrl || fullUrl ? (
						isVideo && fullUrl && isOpened ? (
							<div className="relative w-full h-auto max-h-[350px] flex items-center justify-center bg-overlay/20 overflow-hidden">
								<video
									src={fullUrl}
									preload="metadata"
									className="w-full h-auto max-h-[350px] object-contain block rounded-lg pointer-events-none"
								/>
								{/* Frame overview center play button overlay */}
								<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
									<div className="w-12 h-12 rounded-full bg-background/90 text-foreground shadow-2xl backdrop-blur-md flex items-center justify-center border border-overlay-foreground/10 group-hover:scale-110 active:scale-95 transition-all duration-200">
										<Play size={22} fill="currentColor" />
									</div>
								</div>
							</div>
						) : (
							<img
								src={fullUrl && isOpened ? fullUrl : thumbUrl || ''}
								alt={meta.name || t('chat.media.image_alt')}
								className={`w-full h-auto max-h-[350px] object-contain block transition-all duration-300 ${
									isOpened
										? 'filter blur-0 scale-100'
										: 'filter blur-xl scale-110 pointer-events-none'
								}`}
							/>
						)
					) : (
						<div className="w-full h-[200px] flex flex-col items-center justify-center text-muted-foreground gap-2 bg-popover">
							{isVideo ? <Film size={48} /> : <ImageIcon size={48} />}
						</div>
					)}
				</div>

				{/* UNOPENED STATE OVERLAY: Centered Down Arrow Icon */}
				{!isOpened && (
					<div className="absolute inset-0 bg-overlay/25 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-10 transition-all">
						{isDecrypting ? (
							<div className="flex flex-col items-center justify-center gap-2">
								<Loader2 size={28} className="text-overlay-foreground animate-spin" />
								{progress > 0 && (
									<div className="flex flex-col items-center gap-1 w-28">
										<div className="w-full bg-overlay-foreground/20 h-1.5 rounded-full overflow-hidden">
											<div
												className="bg-primary h-full transition-all duration-150"
												style={{ width: `${progress}%` }}
											/>
										</div>
										<span className="text-[10px] font-semibold text-overlay-foreground tabular-nums">
											{progress}%
										</span>
									</div>
								)}
							</div>
						) : (
							<button
								type="button"
								onClick={handleReveal}
								className="w-12 h-12 rounded-full bg-background/90 hover:bg-background text-foreground shadow-2xl backdrop-blur-md flex items-center justify-center border border-overlay-foreground/10 hover:scale-110 active:scale-95 transition cursor-pointer group/btn"
								title={t('chat.media.download_view')}
							>
								<ArrowDown
									size={22}
									className="block shrink-0 transition-transform"
								/>
							</button>
						)}
					</div>
				)}

				{/* OPENED STATE: Hover Controls for Images (Expand, Download) */}
				{isOpened && isImage && (
					<div
						className="absolute inset-0 bg-overlay/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 z-10"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setIsFullscreenOpen(true);
								if (!fullUrl) handleFullscreen(e);
							}}
							className="bg-background/90 p-2.5 rounded-full shadow-2xl hover:scale-110 transition cursor-pointer text-foreground"
							title={t('chat.media.fullscreen')}
						>
							<Expand size={20} />
						</button>

						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleDownload(e);
							}}
							className="bg-background/90 p-2.5 rounded-full shadow-2xl hover:scale-110 transition cursor-pointer text-foreground"
							title={t('chat.media.download_image')}
						>
							<Download size={20} />
						</button>
					</div>
				)}

				{/* OPENED STATE: Hover Quick Download for Videos */}
				{isOpened && isVideo && (
					<div
						className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleDownload(e);
							}}
							className="bg-overlay/60 hover:bg-overlay/80 text-overlay-foreground p-2 rounded-full shadow-lg backdrop-blur-sm transition cursor-pointer hover:scale-110"
							title={t('chat.media.download_video')}
						>
							<Download size={16} />
						</button>
					</div>
				)}
			</div>

			<MediaViewer
				open={isFullscreenOpen}
				onOpenChange={setIsFullscreenOpen}
				title={meta.name || t('chat.media.preview')}
				subtitle={`${(meta.size / 1024).toFixed(1)} KB`}
				actions={
					<IconButton
						label={t('chat.media.download')}
						tone="overlay"
						size="md"
						onClick={(e) => handleDownload(e)}
					>
						<Download size={18} />
					</IconButton>
				}
			>
				{fullUrl ? (
					isImage ? (
						<img
							src={fullUrl}
							className="max-h-[85vh] max-w-[92vw] select-none object-contain"
							alt={meta.name || t('chat.media.image_alt')}
						/>
					) : (
						<div className="flex max-h-[75vh] w-full max-w-4xl items-center justify-center">
							<CustomVideoPlayer src={fullUrl} autoPlay poster={thumbUrl || undefined} />
						</div>
					)
				) : (
					<div className="flex flex-col items-center gap-4">
						<Loader2 size={48} className="animate-spin text-primary" />
						<div className="h-1 w-48 rounded-full bg-overlay-foreground/20">
							<div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
						</div>
					</div>
				)}
			</MediaViewer>
		</>
	);
};
