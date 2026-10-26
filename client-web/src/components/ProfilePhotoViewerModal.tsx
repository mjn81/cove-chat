import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

import { IconButton } from '@/components/icon-button';
import { MediaViewer } from '@/components/media-viewer';
import { useCachedAvatar, loadAvatar } from '@/lib/avatarCache';
import { getFileUrl } from '@/api/client';
import { wrapIndex } from '@/utils/collection';
import { logger } from '@/utils/logger';

interface ProfilePhotoViewerModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Avatar file IDs or direct (`blob:`, `http(s):`, `data:`) URLs. */
	photos: string[];
	initialIndex?: number;
	username?: string;
	title?: string;
}

/** True for values that are already loadable URLs rather than avatar file IDs. */
const isDirectUrl = (value: string) =>
	value.startsWith('blob:') ||
	value.startsWith('http://') ||
	value.startsWith('https://') ||
	value.startsWith('data:');

/**
 * Fullscreen gallery for a user's profile photos with download, arrow-key
 * navigation and preloading of the neighbouring photos.
 */
export const ProfilePhotoViewerModal: React.FC<ProfilePhotoViewerModalProps> = ({
	open,
	onOpenChange,
	photos,
	initialIndex = 0,
	username,
	title,
}) => {
	const { t } = useTranslation();
	const [currentIndex, setCurrentIndex] = useState(initialIndex);

	// Re-clamp the index whenever the viewer opens or its inputs change (state adjusted during render, not in an effect).
	const resetKey = `${open}|${initialIndex}|${photos.length}`;
	const [prevResetKey, setPrevResetKey] = useState(resetKey);
	if (resetKey !== prevResetKey) {
		setPrevResetKey(resetKey);
		if (open) setCurrentIndex(Math.max(0, Math.min(initialIndex, photos.length - 1)));
	}

	const currentPhoto = photos[currentIndex] || '';
	const direct = isDirectUrl(currentPhoto);

	const { url: cachedUrl, isLoading } = useCachedAvatar(direct ? undefined : currentPhoto);
	const activeUrl = direct ? currentPhoto : cachedUrl || getFileUrl(currentPhoto);

	// Preload adjacent photos
	useEffect(() => {
		if (!open || photos.length <= 1) return;
		for (const step of [1, -1]) {
			const id = photos[wrapIndex(currentIndex, step, photos.length)];
			if (id && !isDirectUrl(id)) loadAvatar(id).catch(() => {});
		}
	}, [open, currentIndex, photos]);

	const handlePrev = useCallback(
		() => setCurrentIndex((i) => wrapIndex(i, -1, photos.length)),
		[photos.length],
	);
	const handleNext = useCallback(
		() => setCurrentIndex((i) => wrapIndex(i, 1, photos.length)),
		[photos.length],
	);

	const handleDownload = async () => {
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
			logger.error('Failed to download photo', { error: String(err) });
		}
	};

	if (!open || photos.length === 0) return null;

	const heading =
		title || (username ? t('profile.photo_title_user', { name: username }) : t('profile.photo_title'));
	const multiple = photos.length > 1;

	return (
		<MediaViewer
			open={open}
			onOpenChange={onOpenChange}
			title={heading}
			subtitle={
				multiple
					? t('profile.photo_counter', { current: currentIndex + 1, total: photos.length })
					: undefined
			}
			actions={
				<IconButton
					label={t('profile.download_photo')}
					tone="overlay"
					size="md"
					onClick={handleDownload}
				>
					<Download size={18} />
				</IconButton>
			}
			onPrev={multiple ? handlePrev : undefined}
			onNext={multiple ? handleNext : undefined}
			position={multiple ? { index: currentIndex, total: photos.length, onSelect: setCurrentIndex } : undefined}
		>
			{isLoading ? (
				<div className="flex h-64 w-64 items-center justify-center">
					<Loader2 size={40} className="animate-spin text-primary" />
				</div>
			) : activeUrl ? (
				<img
					src={activeUrl}
					alt={username || t('profile.photo_title')}
					className="max-h-[82vh] max-w-[92vw] select-none rounded-lg border border-overlay-foreground/10 object-contain animate-in zoom-in-95 duration-200 sm:max-h-[85vh]"
					draggable={false}
				/>
			) : (
				<div className="flex h-64 w-64 items-center justify-center text-sm opacity-60">
					{t('profile.photo_unavailable')}
				</div>
			)}
		</MediaViewer>
	);
};

export default ProfilePhotoViewerModal;
