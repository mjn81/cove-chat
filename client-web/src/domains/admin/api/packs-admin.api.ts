import { apiClient, request } from '@/api/client';
import type { ItemUploadResponse, Pack } from '@/domains/stickers/types/stickers.types';

const enc = encodeURIComponent;
type Status = { status: string };

/** Every pack on the server (built-in, server, all user packs) for management and moderation. */
export const adminListPacks = () => request<{ items: Pack[] }>(apiClient.get('/api/admin/packs'));

/** Creates a server pack (shown to every user while enabled). */
export const adminCreatePack = (name: string, description?: string) =>
	request<Pack>(apiClient.post('/api/admin/packs', { name, ...(description ? { description } : {}) }));

/** Changes a pack: server packs take every field, built-in packs only enabled/default/order, user packs name/description. */
export const adminUpdatePack = (id: string, changes: { name?: string; description?: string; enabled?: boolean; default?: boolean; order?: number }) =>
	request<Pack>(apiClient.patch(`/api/admin/packs/${enc(id)}`, changes));

/** Removes a server or user pack (audited). Built-in packs are disabled instead. */
export const adminDeletePack = (id: string) => request<Status>(apiClient.delete(`/api/admin/packs/${enc(id)}`));

/** Uploads a sticker into any stored pack, without user quotas. */
export function adminUploadSticker(packId: string, file: Blob, emoji?: string, fileName = 'sticker.webp') {
	const form = new FormData();
	form.append('file', file, fileName);
	if (emoji) form.append('emoji', emoji);
	return request<ItemUploadResponse>(
		apiClient.post(`/api/admin/packs/${enc(packId)}/items`, form, { headers: { 'Content-Type': 'multipart/form-data' } }),
	);
}

export const adminDeleteSticker = (packId: string, itemId: string) =>
	request<Status>(apiClient.delete(`/api/admin/packs/${enc(packId)}/items/${enc(itemId)}`));

export const adminReorderStickers = (packId: string, itemIds: string[]) =>
	request<Status>(apiClient.put(`/api/admin/packs/${enc(packId)}/order`, { item_ids: itemIds }));

/**
 * Adds a custom emoji (multipart `name`, `file`). The server normalises the name (`:Name:` becomes `name`) and the image.
 *
 * @param name - Shortcode, with or without colons.
 * @param file - PNG, WebP or GIF.
 */
export function adminAddCustomEmoji(name: string, file: Blob, fileName = 'emoji.png') {
	const form = new FormData();
	form.append('name', name);
	form.append('file', file, fileName);
	return request<ItemUploadResponse>(
		apiClient.post('/api/admin/emoji', form, { headers: { 'Content-Type': 'multipart/form-data' } }),
	);
}

export const adminDeleteCustomEmoji = (name: string) => request<Status>(apiClient.delete(`/api/admin/emoji/${enc(name)}`));
