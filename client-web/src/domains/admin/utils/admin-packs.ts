import type { Pack } from '@/domains/stickers/types/stickers.types';

/** Result of checking the admin's emoji style choice before it is saved. */
export type StyleSelectionProblem = 'none_enabled' | 'default_not_enabled' | null;

/**
 * The server requires at least one enabled style and a default that is one of them (`emoji.enabled_styles`,
 * `emoji.default_style`); checking here avoids a round trip that would only be refused.
 *
 * @param enabled - Style ids ticked by the admin.
 * @param defaultStyle - The chosen default.
 */
export function checkStyleSelection(enabled: readonly string[], defaultStyle: string): StyleSelectionProblem {
	if (enabled.length === 0) return 'none_enabled';
	return enabled.includes(defaultStyle) ? null : 'default_not_enabled';
}

/**
 * Toggles one style in the enabled list, keeping the server's canonical order (the order of `all`) so saving does
 * not reshuffle the list. Returns the new list and a default that is still valid.
 *
 * @param all - Every style id the server knows (the setting's options).
 * @param enabled - Currently enabled ids.
 * @param id - The style being toggled.
 * @param defaultStyle - The current default.
 */
export function toggleStyle(
	all: readonly string[],
	enabled: readonly string[],
	id: string,
	defaultStyle: string,
): { enabled: string[]; defaultStyle: string } {
	const set = new Set(enabled);
	if (set.has(id)) set.delete(id);
	else set.add(id);
	const next = all.filter((s) => set.has(s));
	return { enabled: next, defaultStyle: next.includes(defaultStyle) ? defaultStyle : (next[0] ?? defaultStyle) };
}

/** One `order` change to send as `PATCH /api/admin/packs/{id}`. */
export interface OrderChange {
	id: string;
	order: number;
}

/**
 * Moves a pack up or down in the admin list by swapping `order` values with its neighbour. Packs share one global
 * order; only the two packs that trade places are patched.
 *
 * @param packs - Server and built-in packs sorted by `order`.
 * @param index - Index of the pack to move.
 * @param direction - -1 for up, +1 for down.
 * @returns the two changes, or an empty list when the move is not possible.
 */
export function swapPackOrder(packs: readonly Pick<Pack, 'id' | 'order'>[], index: number, direction: -1 | 1): OrderChange[] {
	const other = index + direction;
	if (index < 0 || index >= packs.length || other < 0 || other >= packs.length) return [];
	const a = packs[index];
	const b = packs[other];
	// Equal order values would make the swap a no-op, so give the pair distinct values first.
	if (a.order === b.order) return [{ id: a.id, order: b.order + direction }, { id: b.id, order: b.order }];
	return [{ id: a.id, order: b.order }, { id: b.id, order: a.order }];
}

/**
 * Splits the admin pack list into what the moderation list and the server-pack manager show.
 *
 * @param packs - Items of `GET /api/admin/packs`.
 */
export function splitAdminPacks(packs: readonly Pack[]): { managed: Pack[]; user: Pack[] } {
	const byOrder = (a: Pack, b: Pack) => a.order - b.order || a.name.localeCompare(b.name);
	return {
		managed: packs.filter((p) => p.scope !== 'user').sort(byOrder),
		user: packs.filter((p) => p.scope === 'user').sort((a, b) => (a.owner_name ?? '').localeCompare(b.owner_name ?? '') || a.name.localeCompare(b.name)),
	};
}
