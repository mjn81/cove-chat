/**
 * Shapes the emoji-mart dataset (names, keywords, categories; its own images are not used) into what the picker
 * grid needs, and searches it. Kept free of React so it can be tested without the 400 KB dataset.
 */

/** The parts of `@emoji-mart/data` the picker reads. */
export interface RawEmojiData {
	categories: { id: string; emojis: string[] }[];
	emojis: Record<string, { id: string; name: string; keywords?: string[]; skins: { native: string }[] }>;
}

/** One picker entry: the default-skin character plus what search matches on. */
export interface PickerEmoji {
	id: string;
	name: string;
	keywords: string[];
	native: string;
}

/** A named group of emoji in display order. */
export interface PickerCategory {
	id: string;
	emojis: PickerEmoji[];
}

/**
 * Turns the raw dataset into display categories (default skin tone only), dropping ids that have no entry.
 *
 * @param data - The emoji-mart dataset.
 */
export function buildCategories(data: RawEmojiData): PickerCategory[] {
	return data.categories.map((category) => ({
		id: category.id,
		emojis: category.emojis.flatMap((id) => {
			const e = data.emojis[id];
			const native = e?.skins?.[0]?.native;
			return e && native ? [{ id: e.id, name: e.name, keywords: e.keywords ?? [], native }] : [];
		}),
	}));
}

/**
 * Finds emoji whose name or keywords match every word of the query. Name-prefix matches rank first.
 *
 * @param categories - Result of {@link buildCategories}.
 * @param query - What the user typed.
 * @param limit - Most results.
 */
export function searchEmoji(categories: readonly PickerCategory[], query: string, limit = 90): PickerEmoji[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const ranked: { e: PickerEmoji; score: number }[] = [];
	for (const category of categories) {
		for (const e of category.emojis) {
			const name = e.name.toLowerCase();
			let score = 0;
			let all = true;
			for (const w of words) {
				if (name.startsWith(w)) score += 3;
				else if (name.includes(w)) score += 2;
				else if (e.keywords.some((k) => k.toLowerCase().includes(w))) score += 1;
				else {
					all = false;
					break;
				}
			}
			if (all) ranked.push({ e, score });
		}
	}
	return ranked
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((r) => r.e);
}
