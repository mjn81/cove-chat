import { apiClient, request } from '@/api/client';
import type { AttributionEntry, ItemUploadResponse, Pack, PackListResponse } from '../types/stickers.types';

/** Query keys for the stickers domain; invalidate through these, never by string. */
export const stickerKeys = {
	all: ['stickers'] as const,
	packs: () => ['stickers', 'packs'] as const,
	pack: (id: string) => ['stickers', 'pack', id] as const,
	attribution: () => ['stickers', 'attribution'] as const,
};

const enc = encodeURIComponent;

/** The caller's picker: built-in and server packs plus owned or added user packs, with the upload quota. */
export const apiListPacks = () => request<PackListResponse>(apiClient.get('/api/packs'));

/** One pack with its items. Any user pack id works (the id is the share link). */
export const apiGetPack = (id: string) => request<Pack>(apiClient.get(`/api/packs/${enc(id)}`));

export const apiCreatePack = (name: string, description?: string) =>
	request<Pack>(apiClient.post('/api/packs', { name, ...(description ? { description } : {}) }));

export const apiRenamePack = (id: string, name: string) => request<Pack>(apiClient.patch(`/api/packs/${enc(id)}`, { name }));

export const apiDeletePack = (id: string) => request<{ status: string }>(apiClient.delete(`/api/packs/${enc(id)}`));

/** Adds a user pack to the caller's picker (the share card's "Add"). Idempotent. */
export const apiInstallPack = (id: string) => request<{ status: string }>(apiClient.put(`/api/packs/${enc(id)}/install`));

export const apiUninstallPack = (id: string) => request<{ status: string }>(apiClient.delete(`/api/packs/${enc(id)}/install`));

/**
 * Uploads one sticker (multipart `file`, optional `emoji`). The server checks magic bytes and normalises the image.
 *
 * @param packId - Target pack (owner only).
 * @param file - The image.
 * @param emoji - The emoji this sticker is suggested for.
 */
export function apiUploadSticker(packId: string, file: Blob, emoji?: string, fileName = 'sticker.webp') {
	const form = new FormData();
	form.append('file', file, fileName);
	if (emoji) form.append('emoji', emoji);
	return request<ItemUploadResponse>(
		apiClient.post(`/api/packs/${enc(packId)}/items`, form, { headers: { 'Content-Type': 'multipart/form-data' } }),
	);
}

export const apiDeleteSticker = (packId: string, itemId: string) =>
	request<{ status: string }>(apiClient.delete(`/api/packs/${enc(packId)}/items/${enc(itemId)}`));

/** Sets the display order; `itemIds` must list every item exactly once. */
export const apiReorderStickers = (packId: string, itemIds: string[]) =>
	request<{ status: string }>(apiClient.put(`/api/packs/${enc(packId)}/order`, { item_ids: itemIds }));

/** Credits for every shipped art set (emoji styles and sticker packs). */
export const apiGetAttribution = () => request<{ items: AttributionEntry[] }>(apiClient.get('/api/packs/attribution'));
