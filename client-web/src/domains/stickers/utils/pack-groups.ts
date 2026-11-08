import type { Pack } from '../types/stickers.types';

/** The sticker panel's tab order: server packs (built-in included, default first), then my packs, then added ones. */
export interface PackGroups {
	server: Pack[];
	mine: Pack[];
	installed: Pack[];
}

/**
 * Splits the picker list into the panel's groups, keeping the server's order inside each group.
 *
 * @param packs - Items of `GET /api/packs` (already default-first).
 * @param userId - The signed-in user, to tell their own packs from added ones.
 */
export function groupPacks(packs: readonly Pack[], userId: string | undefined): PackGroups {
	const groups: PackGroups = { server: [], mine: [], installed: [] };
	for (const pack of packs) {
		if (pack.scope !== 'user') groups.server.push(pack);
		else if (pack.owner_id === userId) groups.mine.push(pack);
		else groups.installed.push(pack);
	}
	return groups;
}

/** Flattens {@link PackGroups} into tab order. */
export function orderedPacks(groups: PackGroups): Pack[] {
	return [...groups.server, ...groups.mine, ...groups.installed];
}

/**
 * Which tab to open: the remembered one if it still exists, else the server's default pack, else the first pack.
 *
 * @param tabs - Pack ids in tab order.
 * @param remembered - Last tab id (`recent` or a pack id).
 * @param defaultPackId - `default_pack_id` from the list response.
 * @param hasRecents - Whether the recent tab exists.
 */
export function initialStickerTab(
	tabs: readonly string[],
	remembered: string | null,
	defaultPackId: string | undefined,
	hasRecents: boolean,
): string | null {
	if (remembered === 'recent' && hasRecents) return 'recent';
	if (remembered && tabs.includes(remembered)) return remembered;
	if (hasRecents) return 'recent';
	if (defaultPackId && tabs.includes(defaultPackId)) return defaultPackId;
	return tabs[0] ?? null;
}
