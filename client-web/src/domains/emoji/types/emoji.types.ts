/** One emoji style as listed by `GET /api/emoji/styles`. Mirrors the backend JSON (snake_case). */
export interface EmojiStyleInfo {
	id: string;
	name: string;
	license: string;
	/** Content hash; part of both asset URLs, so a cached sheet for this version never goes stale. */
	version: string;
	cell_size: number;
	width: number;
	height: number;
	count: number;
	sheet_url: string;
	index_url: string;
	sheet_bytes: number;
	index_bytes: number;
	default?: boolean;
}

/** Response of `GET /api/emoji/styles`. */
export interface EmojiStylesResponse {
	default_style: string;
	enabled_styles: string[];
	styles: EmojiStyleInfo[];
}

/** The sprite index: key (lower-case hex code points joined by `-`, FE0F removed) to the cell's top-left pixel. */
export interface EmojiSpriteIndex {
	size: number;
	width: number;
	height: number;
	emoji: Record<string, [number, number]>;
}

/** A style whose sheet is decoded and ready to draw: the blob URL plus its index. */
export interface LoadedEmojiStyle {
	info: EmojiStyleInfo;
	sheetUrl: string;
	index: EmojiSpriteIndex;
}

/** One entry of `GET /api/emoji/animated`. */
export interface AnimatedEmojiItem {
	sequence: string;
	id: string;
	url: string;
}

/** Response of `GET /api/emoji/animated`. */
export interface AnimatedEmojiResponse {
	version: string;
	items: AnimatedEmojiItem[];
}

/** One server custom emoji. */
export interface CustomEmojiItem {
	name: string;
	url: string;
	file_id?: string;
	animated: boolean;
	width?: number;
	height?: number;
}

/** Response of `GET /api/emoji/custom`. */
export interface CustomEmojiResponse {
	version: string;
	items: CustomEmojiItem[];
}
