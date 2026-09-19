import React, { useState } from 'react';
import {
	ImageIcon,
	Film,
	Loader2,
	Expand,
	Download,
	X,
	ArrowDown,
	Play,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
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
					<span className="absolute top-2 left-2 z-20 pointer-events-none inline-flex items-center justify-center h-5 px-1.5 rounded text-[10px] font-medium leading-none text-white/90 bg-black/60 backdrop-blur-sm shadow-sm tabular-nums">
						{(meta.size / 1024).toFixed(0)} KB
					</span>
				)}

				{/* Media element: blurred when unopened, crisp and clean frame overview when opened */}
				<div className="relative overflow-hidden w-full max-h-[350px] flex items-center justify-center bg-black/20">
					{thumbUrl || fullUrl ? (
						isVideo && fullUrl && isOpened ? (
							<div className="relative w-full h-auto max-h-[350px] flex items-center justify-center bg-black/20 overflow-hidden">
								<video
									src={fullUrl}
									preload="metadata"
									className="w-full h-auto max-h-[350px] object-contain block rounded-lg pointer-events-none"
								/>
								{/* Frame overview center play button overlay */}
								<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
									<div className="w-12 h-12 rounded-full bg-background/90 text-foreground shadow-2xl backdrop-blur-md flex items-center justify-center border border-white/10 group-hover:scale-110 active:scale-95 transition-all duration-200">
										<Play size={22} fill="currentColor" />
									</div>
								</div>
							</div>
						) : (
							<img
								src={fullUrl && isOpened ? fullUrl : thumbUrl || ''}
								alt={meta.name || 'image'}
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
					<div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-10 transition-all">
						{isDecrypting ? (
							<div className="flex flex-col items-center justify-center gap-2">
								<Loader2 size={28} className="text-white animate-spin" />
								{progress > 0 && (
									<div className="flex flex-col items-center gap-1 w-28">
										<div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
											<div
												className="bg-primary h-full transition-all duration-150"
												style={{ width: `${progress}%` }}
											/>
										</div>
										<span className="text-[10px] font-semibold text-white tabular-nums">
											{progress}%
										</span>
									</div>
								)}
							</div>
						) : (
							<button
								type="button"
								onClick={handleReveal}
								className="w-12 h-12 rounded-full bg-background/90 hover:bg-background text-foreground shadow-2xl backdrop-blur-md flex items-center justify-center border border-white/10 hover:scale-110 active:scale-95 transition cursor-pointer group/btn"
								title="Download & View"
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
						className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 z-10"
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
							title="Fullscreen View"
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
							title="Download Image"
						>
							<Download size={20} />
						</button>
					</div>
				)}

				{/* OPENED STATE: Hover Quick Download for Videos */}
				{isOpened && isVideo && (
					<div
						className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleDownload(e);
							}}
							className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-full shadow-lg backdrop-blur-sm transition cursor-pointer hover:scale-110"
							title="Download Video"
						>
							<Download size={16} />
						</button>
					</div>
				)}
			</div>

			{/* Fullscreen Dialog */}
			<Dialog.Root open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100]" />
					<Dialog.Content
						aria-describedby="media-dialog-desc"
						className="fixed inset-0 z-[101] w-screen h-screen flex flex-col items-center justify-center p-3 sm:p-8 focus:outline-none cursor-pointer"
						onClick={() => setIsFullscreenOpen(false)}
					>
						<Dialog.Title className="sr-only">
							{meta.name || 'Media preview'}
						</Dialog.Title>
						<Dialog.Description id="media-dialog-desc" className="sr-only">
							Fullscreen media preview
						</Dialog.Description>

						<Dialog.Close asChild>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setIsFullscreenOpen(false);
								}}
								className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/70 hover:text-white transition-all p-2 bg-black/50 sm:bg-white/10 hover:bg-black/70 rounded-full z-[105] cursor-pointer"
								title="Close (Esc)"
							>
								<X size={24} className="sm:w-7 sm:h-7" />
							</button>
						</Dialog.Close>

						<div className="relative w-full h-full flex flex-col items-center justify-center pointer-events-none">
							{fullUrl ? (
								isImage ? (
									<img
										src={fullUrl}
										className="max-w-full max-h-full object-contain pointer-events-auto cursor-default select-none"
										alt={meta.name || 'fullscreen'}
										onClick={(e) => e.stopPropagation()}
									/>
								) : (
									<div
										className="w-full max-w-4xl max-h-[75vh] flex items-center justify-center pointer-events-auto"
										onClick={(e) => e.stopPropagation()}
									>
										<CustomVideoPlayer
											src={fullUrl}
											autoPlay
											poster={thumbUrl || undefined}
										/>
									</div>
								)
							) : (
								<div className="flex flex-col items-center gap-4 pointer-events-auto">
									<Loader2 size={48} className="text-primary animate-spin" />
									<div className="w-48 bg-white/20 h-1 rounded-full">
										<div
											className="bg-primary h-full transition-all"
											style={{ width: `${progress}%` }}
										/>
									</div>
								</div>
							)}

							{/* Bottom Info & Download Bar (Responsive for mobile long names) */}
							<div
								className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-6 bg-black/75 px-4 py-3 sm:pl-6 sm:pr-3.5 sm:py-2.5 rounded-2xl sm:rounded-full border border-white/15 backdrop-blur-md max-w-[92vw] sm:max-w-xl w-auto pointer-events-auto shadow-2xl z-40"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="text-center sm:text-left min-w-0 max-w-full">
									<div
										className="text-white text-xs sm:text-sm font-semibold truncate max-w-[260px] sm:max-w-[340px]"
										title={meta.name}
									>
										{meta.name || 'File'}
									</div>
									<div className="text-[11px] text-white/60 tabular-nums">
										{(meta.size / 1024).toFixed(1)} KB
									</div>
								</div>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										handleDownload(e);
									}}
									className="w-full sm:w-auto text-white bg-primary hover:bg-primary/90 px-4 py-1.5 rounded-xl sm:rounded-full font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-md"
								>
									<Download size={16} /> Download
								</button>
							</div>
						</div>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
};
