/** One sticker (or custom emoji) of a pack. Mirrors the backend `PackItemResponse`. */
export interface PackItem {
	id: string;
	name?: string;
	/** The emoji this sticker is suggested for. */
	emoji?: string;
	animated: boolean;
	/** Where the image is served, relative to the API base. Use as is. */
	url: string;
	/** Stored image of a server or user sticker (what a sticker message carries); absent for built-in packs. */
	file_id?: string;
	width?: number;
	height?: number;
	bytes: number;
	order: number;
}

export type PackScope = 'builtin' | 'server' | 'user';

/** A sticker pack. List responses leave `items` out and use `item_count` and `cover_url`. */
export interface Pack {
	id: string;
	kind: 'emoji_style' | 'emoji_custom' | 'sticker';
	scope: PackScope;
	owner_id?: string;
	owner_name?: string;
	name: string;
	description?: string;
	/** Changes whenever the contents change. */
	version: string;
	license?: string;
	attribution?: string;
	enabled: boolean;
	default: boolean;
	order: number;
	animated: boolean;
	/** In the caller's picker (built-in and server packs always; user packs when owned or added). */
	installed: boolean;
	/** The caller may change it (owner, or an admin). */
	editable: boolean;
	item_count: number;
	cover_url?: string;
	items?: PackItem[];
	created_at?: string;
}

/** What the caller may still create (`GET /api/packs`). */
export interface PackQuota {
	user_uploads_enabled: boolean;
	max_packs: number;
	max_stickers_per_pack: number;
	max_storage_bytes: number;
	owned_packs: number;
	used_storage_bytes: number;
	/** Per-image caps after the server normalises an upload. */
	sticker_max_bytes: number;
	sticker_max_side: number;
}

/** Response of `GET /api/packs`: the caller's picker. */
export interface PackListResponse {
	items: Pack[];
	default_pack_id?: string;
	quota: PackQuota;
}

/** Response of an item upload. */
export interface ItemUploadResponse {
	item: PackItem;
	pack: Pack;
}

/** One credit line from `GET /api/packs/attribution`. */
export interface AttributionEntry {
	id: string;
	name: string;
	kind: 'emoji_style' | 'sticker';
	license: string;
	attribution: string;
	source: string;
}

/** Decrypted body of a `sticker` message. */
export interface StickerBody {
	pack_id: string;
	sticker_id: string;
	/** Stored image id for server and user packs; empty for built-in packs. */
	file_id: string;
}
