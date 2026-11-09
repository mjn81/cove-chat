import { buildCategories, type PickerCategory, type RawEmojiData } from './picker-data';

/**
 * Module-level cache for the picker's category data. The 400 KB dataset is imported and shaped once per page
 * load, however often the picker opens, and can be warmed up in idle time before the first open.
 */

type Loader = () => Promise<RawEmojiData>;

const defaultLoader: Loader = () => import('@emoji-mart/data').then((m) => m.default as unknown as RawEmojiData);

const cache = new Map<number, Promise<PickerCategory[]>>();
let raw: Promise<RawEmojiData> | null = null;

/**
 * The picker categories for a skin tone, built once and then served from memory.
 *
 * @param skin - Skin tone 1 (default) to 6.
 * @param loader - Dataset loader; tests inject a stub to count calls.
 */
export function getPickerCategories(skin = 1, loader: Loader = defaultLoader): Promise<PickerCategory[]> {
	let hit = cache.get(skin);
	if (!hit) {
		raw ??= loader();
		hit = raw.then((data) => buildCategories(data, skin));
		cache.set(skin, hit);
	}
	return hit;
}

/** Test helper: forgets everything cached. */
export function resetPickerCacheForTests(): void {
	cache.clear();
	raw = null;
}
