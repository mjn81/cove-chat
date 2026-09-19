import React, { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X, Download, Loader2 } from 'lucide-react';
import { useCachedAvatar, loadAvatar } from '@/lib/avatarCache';
import { getFileUrl } from '@/api/client';

interface ProfilePhotoViewerModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	photos: string[]; // List of avatar file IDs or URLs
	initialIndex?: number;
	username?: string;
	title?: string;
}

export const ProfilePhotoViewerModal: React.FC<ProfilePhotoViewerModalProps> = ({
	open,
	onOpenChange,
	photos,
	initialIndex = 0,
	username,
	title,
}) => {
	const [currentIndex, setCurrentIndex] = useState(initialIndex);

	useEffect(() => {
		if (open) {
			setCurrentIndex(Math.max(0, Math.min(initialIndex, photos.length - 1)));
		}
	}, [open, initialIndex, photos.length]);

	const currentPhoto = photos[currentIndex] || '';
	const isDirectUrl =
		currentPhoto.startsWith('blob:') ||
		currentPhoto.startsWith('http://') ||
		currentPhoto.startsWith('https://') ||
		currentPhoto.startsWith('data:');

	const { url: cachedUrl, isLoading } = useCachedAvatar(
		isDirectUrl ? undefined : currentPhoto,
	);
	const activeUrl = isDirectUrl ? currentPhoto : cachedUrl || getFileUrl(currentPhoto);

	// Preload adjacent photos
	useEffect(() => {
		if (!open || photos.length <= 1) return;
		const nextIdx = (currentIndex + 1) % photos.length;
		const prevIdx = (currentIndex - 1 + photos.length) % photos.length;

		const preload = (id: string) => {
			if (
				id &&
				!id.startsWith('blob:') &&
				!id.startsWith('http') &&
				!id.startsWith('data:')
			) {
				loadAvatar(id).catch(() => {});
			}
		};

		preload(photos[nextIdx]);
		preload(photos[prevIdx]);
	}, [open, currentIndex, photos]);

	const handlePrev = useCallback(
		(e?: React.MouseEvent) => {
			e?.stopPropagation();
			if (photos.length <= 1) return;
			setCurrentIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
		},
		[photos.length],
	);

	const handleNext = useCallback(
		(e?: React.MouseEvent) => {
			e?.stopPropagation();
			if (photos.length <= 1) return;
			setCurrentIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
		},
		[photos.length],
	);

	// Keyboard controls (Arrow keys and Escape)
	useEffect(() => {
		if (!open) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				handlePrev();
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				handleNext();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				onOpenChange(false);
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [open, handlePrev, handleNext, onOpenChange]);

	const handleDownload = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!activeUrl) return;

		try {
			const res = await fetch(activeUrl);
			const blob = await res.blob();
			const blobUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = blobUrl;
			a.download = `${username ? `${username}_` : ''}profile_photo_${currentIndex + 1}.jpg`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(blobUrl);
		} catch (err) {
			console.error('Failed to download photo', err);
		}
	};

	if (!open || photos.length === 0) return null;

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/95 backdrop-blur-md z-50 animate-in fade-in duration-200" />
				<Dialog.Content
					className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 outline-none select-none pointer-events-none"
					onClick={() => onOpenChange(false)}
				>
					<Dialog.Title className="sr-only">
						{title || `${username || 'User'}'s Profile Photo`}
					</Dialog.Title>

					{/* Top Header Bar */}
					<div
						className="absolute top-4 inset-x-4 sm:inset-x-6 flex items-center justify-between pointer-events-auto z-50 text-white"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex flex-col min-w-0">
							<span className="font-bold text-sm sm:text-base truncate drop-shadow-md">
								{title || (username ? `${username}'s Photo` : 'Profile Photo')}
							</span>
							{photos.length > 1 && (
								<span className="text-xs text-white/70 font-mono">
									{currentIndex + 1} of {photos.length}
								</span>
							)}
						</div>

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={handleDownload}
								className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center backdrop-blur-md border border-white/15 transition cursor-pointer shadow-lg"
								title="Download photo"
							>
								<Download size={18} />
							</button>
							<button
								type="button"
								onClick={() => onOpenChange(false)}
								className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center backdrop-blur-md border border-white/15 transition cursor-pointer shadow-lg"
								title="Close (Esc)"
							>
								<X size={20} />
							</button>
						</div>
					</div>

					{/* Main Image Container */}
					<div
						className="relative max-w-full max-h-full flex items-center justify-center pointer-events-auto"
						onClick={(e) => e.stopPropagation()}
					>
						{isLoading ? (
							<div className="w-64 h-64 flex items-center justify-center">
								<Loader2 size={40} className="text-primary animate-spin" />
							</div>
						) : activeUrl ? (
							<img
								src={activeUrl}
								alt={username || 'Profile photo'}
								className="max-w-[92vw] max-h-[82vh] sm:max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10 select-none animate-in zoom-in-95 duration-200"
								draggable={false}
							/>
						) : (
							<div className="w-64 h-64 flex flex-col items-center justify-center text-white/60 text-sm">
								<span>Image not available</span>
							</div>
						)}

						{/* Previous Photo Button */}
						{photos.length > 1 && (
							<button
								type="button"
								onClick={handlePrev}
								className="absolute left-2 sm:-left-14 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/60 hover:bg-black/90 active:scale-95 text-white flex items-center justify-center backdrop-blur-md border border-white/20 transition cursor-pointer shadow-xl z-50"
								title="Previous photo (Left Arrow)"
							>
								<ChevronLeft size={24} />
							</button>
						)}

						{/* Next Photo Button */}
						{photos.length > 1 && (
							<button
								type="button"
								onClick={handleNext}
								className="absolute right-2 sm:-right-14 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/60 hover:bg-black/90 active:scale-95 text-white flex items-center justify-center backdrop-blur-md border border-white/20 transition cursor-pointer shadow-xl z-50"
								title="Next photo (Right Arrow)"
							>
								<ChevronRight size={24} />
							</button>
						)}
					</div>

					{/* Bottom Photo Dots (if multiple photos) */}
					{photos.length > 1 && (
						<div
							className="absolute bottom-5 inset-x-0 flex items-center justify-center gap-2 pointer-events-auto z-50"
							onClick={(e) => e.stopPropagation()}
						>
							{photos.map((_, idx) => (
								<button
									key={idx}
									type="button"
									onClick={() => setCurrentIndex(idx)}
									className={`h-2 rounded-full transition-all cursor-pointer ${
										currentIndex === idx
											? 'w-6 bg-primary shadow-md shadow-primary/50'
											: 'w-2 bg-white/40 hover:bg-white/70'
									}`}
									title={`Photo ${idx + 1}`}
								/>
							))}
						</div>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
};

export default ProfilePhotoViewerModal;
