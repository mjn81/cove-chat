import type { PackItem } from '../types/stickers.types';

/** A sticker the user sent recently, kept with what is needed to draw and re-send it. */
export interface RecentSticker {
	pack_id: string;
	item: Pick<PackItem, 'id' | 'url' | 'file_id' | 'animated' | 'emoji'>;
}

/** How many recent stickers the panel remembers. */
export const MAX_RECENT_STICKERS = 24;

const sameSticker = (a: RecentSticker, b: RecentSticker) => a.pack_id === b.pack_id && a.item.id === b.item.id;

/**
 * Puts a sticker at the front of the recents, de-duplicated by pack and sticker id and capped.
 *
 * @param recents - Current list, newest first.
 * @param sticker - The sticker that was just sent.
 * @param max - List cap.
 */
export function pushRecentSticker(recents: readonly RecentSticker[], sticker: RecentSticker, max = MAX_RECENT_STICKERS): RecentSticker[] {
	return [sticker, ...recents.filter((r) => !sameSticker(r, sticker))].slice(0, max);
}

/**
 * Drops recents of a pack that no longer exists or was removed from the picker.
 *
 * @param recents - Current list.
 * @param packIds - Ids of the packs the picker still has.
 */
export function pruneRecentStickers(recents: readonly RecentSticker[], packIds: ReadonlySet<string>): RecentSticker[] {
	return recents.filter((r) => packIds.has(r.pack_id));
}
