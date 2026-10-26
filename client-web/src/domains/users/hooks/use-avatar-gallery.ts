import { useCallback, useState } from 'react';

import { apiUploadFile } from '@/api/client';
import { useAuthStore } from '@/store/store';
import { logger } from '@/utils/logger';
import { galleryAfterRemove, galleryAfterUpload, getGallery, promoteInGallery } from '../utils/avatar-gallery';

/**
 * The current user's profile photos: upload a cropped image, choose the
 * primary one, delete one. All changes go through `updateUser`.
 */
export function useAvatarGallery() {
	const user = useAuthStore((s) => s.user);
	const updateUser = useAuthStore((s) => s.updateUser);
	const [isUploading, setIsUploading] = useState(false);
	const gallery = getGallery(user);

	const upload = useCallback(
		async (blob: Blob, mime: string) => {
			setIsUploading(true);
			try {
				const { id } = await apiUploadFile(blob, mime);
				await updateUser({ avatar_id: id, avatar_ids: galleryAfterUpload(getGallery(user), id) });
			} catch (err) {
				logger.error('Failed to upload avatar', { error: String(err) });
			} finally {
				setIsUploading(false);
			}
		},
		[user, updateUser],
	);

	const makePrimary = useCallback(
		async (id: string) => {
			if (id === user?.avatar_id) return;
			await updateUser({ avatar_id: id, avatar_ids: promoteInGallery(getGallery(user), id) });
		},
		[user, updateUser],
	);

	const remove = useCallback(
		async (id: string) => {
			await updateUser(galleryAfterRemove(getGallery(user), user?.avatar_id, id));
		},
		[user, updateUser],
	);

	return { gallery, isUploading, upload, makePrimary, remove };
}
