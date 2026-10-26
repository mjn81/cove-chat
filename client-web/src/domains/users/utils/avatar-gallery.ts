/** Users can keep up to this many profile photos. */
export const MAX_AVATARS = 5;

interface AvatarOwner {
	avatar_id?: string;
	avatar_ids?: string[];
}

/**
 * The user's profile photos, newest/primary first. Older accounts only have
 * the single `avatar_id`, so it is used when the list is empty.
 */
export function getGallery(user: AvatarOwner | null | undefined): string[] {
	if (user?.avatar_ids && user.avatar_ids.length > 0) return user.avatar_ids;
	return user?.avatar_id ? [user.avatar_id] : [];
}

/** Makes `id` the first (primary) photo, keeping the rest in order. */
export function promoteInGallery(gallery: string[], id: string): string[] {
	return [id, ...gallery.filter((x) => x !== id)];
}

/** Gallery after uploading `newId`: it becomes primary and the oldest photo falls off at the limit. */
export function galleryAfterUpload(gallery: string[], newId: string): string[] {
	return promoteInGallery(gallery, newId).slice(0, MAX_AVATARS);
}

/**
 * Gallery and primary avatar after deleting `id`. If the primary is deleted
 * the next photo takes over; with no photos left the primary is cleared.
 */
export function galleryAfterRemove(
	gallery: string[],
	primaryId: string | undefined,
	id: string,
): { avatar_ids: string[]; avatar_id: string } {
	const avatar_ids = gallery.filter((x) => x !== id);
	const avatar_id = primaryId === id ? avatar_ids[0] || '' : primaryId || '';
	return { avatar_ids, avatar_id };
}
