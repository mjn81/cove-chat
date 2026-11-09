import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { loadAssetBytes } from '@/lib/asset-cache';
import { apiGetAnimatedEmoji, apiGetCustomEmoji, apiGetEmojiStyles, emojiKeys } from '../api/emoji.api';
import { useEmojiSettings } from '../store/emoji.store';
import type { EmojiSpriteIndex, EmojiStyleInfo, LoadedEmojiStyle } from '../types/emoji.types';
import { NATIVE_STYLE, resolveAnimated, resolveEmojiStyle } from '../utils/emoji-settings';
import { chooseFallbackStyle, styleCacheKey } from '../utils/sprite';

/** The styles the server offers (`emoji_packs`). Disabled, hence empty, on servers without the capability. */
export function useEmojiStyles() {
	const { supports } = useServerCapabilities();
	return useQuery({
		queryKey: emojiKeys.styles(),
		queryFn: apiGetEmojiStyles,
		enabled: supports('emoji_packs'),
		staleTime: 5 * 60_000,
	});
}

/** Style id to draw with, after applying the saved choice to what the server offers. `native` means "device font". */
export function useActiveEmojiStyleId(): string {
	const choice = useEmojiSettings((s) => s.style);
	const { data } = useEmojiStyles();
	return resolveEmojiStyle(choice, data?.enabled_styles, data?.default_style);
}

/** Downloads (or reads from IndexedDB) a style's sheet and index and turns them into a ready-to-draw style. */
async function loadStyle(info: EmojiStyleInfo): Promise<LoadedEmojiStyle> {
	const [sheet, indexBytes] = await Promise.all([
		loadAssetBytes(info.sheet_url, styleCacheKey(info.id, info.version, 'sheet')),
		loadAssetBytes(info.index_url, styleCacheKey(info.id, info.version, 'index')),
	]);
	if (!sheet || !indexBytes) throw new Error(`emoji style ${info.id} unavailable`);
	const index = JSON.parse(new TextDecoder().decode(indexBytes)) as EmojiSpriteIndex;
	const sheetUrl = URL.createObjectURL(new Blob([sheet as BlobPart], { type: 'image/webp' }));
	// Decode the (large) sheet before reporting it ready. Otherwise the first paint of every cell waits for the
	// decode while the glyph is already hidden, which shows as blank emoji for a moment.
	if (typeof Image !== 'undefined') {
		const img = new Image();
		img.src = sheetUrl;
		await img.decode?.().catch(() => undefined);
	}
	return { info, sheetUrl, index };
}

/**
 * A specific style's decoded sheet, or null while it loads or when the style is `native`. The first use of a style
 * downloads it (`sheet_bytes`); afterwards it comes from IndexedDB. Rendering never waits for it: callers draw the
 * native glyph until this returns a style.
 *
 * @param styleId - Style id to load; defaults to the active style.
 * @param wanted - Set false to load nothing (used for the fallback style, which is fetched only when needed).
 */
export function useLoadedEmojiStyle(styleId?: string, wanted = true): LoadedEmojiStyle | null {
	const active = useActiveEmojiStyleId();
	const id = styleId ?? active;
	const { data: styles } = useEmojiStyles();
	const info = !wanted || id === NATIVE_STYLE ? undefined : styles?.styles.find((s) => s.id === id);
	const { data } = useQuery({
		queryKey: emojiKeys.sheet(id, info?.version ?? ''),
		queryFn: () => loadStyle(info!),
		enabled: !!info,
		staleTime: Infinity,
		gcTime: Infinity,
		retry: 1,
	});
	return data ?? null;
}

/** The big-emoji animation table as a lookup. Empty when the capability is missing. */
export function useAnimatedEmoji() {
	const { supports } = useServerCapabilities();
	const { data } = useQuery({
		queryKey: emojiKeys.animated(),
		queryFn: apiGetAnimatedEmoji,
		enabled: supports('animated_emoji'),
		staleTime: 10 * 60_000,
	});
	const map = useMemo(() => new Map((data?.items ?? []).map((i) => [i.sequence, i.url])), [data]);
	const has = useCallback((key: string) => map.has(key), [map]);
	const urlFor = useCallback((key: string) => map.get(key), [map]);
	return { has, urlFor, size: map.size };
}

/** Whether animations may play: the user's switch, else the OS reduced-motion setting. */
export function useAnimatedEnabled(): boolean {
	const preferred = useEmojiSettings((s) => s.animated);
	const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
	return resolveAnimated(preferred, reduced);
}

/** The server's custom emoji and a name lookup. Empty when the capability is missing. */
export function useCustomEmoji() {
	const { supports } = useServerCapabilities();
	const query = useQuery({
		queryKey: emojiKeys.custom(),
		queryFn: apiGetCustomEmoji,
		enabled: supports('custom_emoji'),
		staleTime: 5 * 60_000,
	});
	const items = useMemo(() => query.data?.items ?? [], [query.data]);
	const names = useMemo(() => new Set(items.map((i) => i.name)), [items]);
	const byName = useMemo(() => new Map(items.map((i) => [i.name, i])), [items]);
	return { items, names, byName, refetch: query.refetch };
}

/** Id of the style that fills gaps in the active one (Twemoji, for flags and keycaps missing from Noto); null when none. */
export function useFallbackStyleId(): string | null {
	const active = useActiveEmojiStyleId();
	const { data } = useEmojiStyles();
	return useMemo(
		() =>
			data
				? chooseFallbackStyle(data.enabled_styles, active, Object.fromEntries(data.styles.map((s) => [s.id, s.count])))
				: null,
		[data, active],
	);
}
