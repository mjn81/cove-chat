/** The facts about a selected message that decide which bulk actions are offered. */
export interface SelectableMessage {
	sender_id: string;
	type: string;
}

/** Which actions the selection bar offers for the current selection. */
export interface SelectionActions {
	canDelete: boolean;
	canForward: boolean;
	canCopy: boolean;
	canReply: boolean;
}

/** Message types the forward dialog knows how to re-send. */
const FORWARDABLE = new Set(['text', 'file', 'voice', 'video', 'invite', 'sticker']);

/**
 * What the selection bar offers (Telegram style): delete only when the user may delete every selected message,
 * forward when every one can be re-sent, copy only for all-text selections, reply for a single message.
 *
 * @param selected - The selected messages.
 * @param userId - The signed-in user.
 * @param isChannelAdmin - Admins and owners may delete other people's messages.
 */
export function selectionActions(
	selected: SelectableMessage[],
	userId: string,
	isChannelAdmin: boolean,
): SelectionActions {
	if (selected.length === 0) return { canDelete: false, canForward: false, canCopy: false, canReply: false };
	return {
		canDelete: selected.every((m) => m.sender_id === userId || isChannelAdmin),
		canForward: selected.every((m) => FORWARDABLE.has(m.type)),
		canCopy: selected.every((m) => m.type === 'text'),
		canReply: selected.length === 1,
	};
}

/**
 * Adds an id to the selection, or removes it when it is already there.
 *
 * @param current - Currently selected ids.
 * @param id - The id that was clicked.
 */
export function toggleSelected(current: string[], id: string): string[] {
	return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}
