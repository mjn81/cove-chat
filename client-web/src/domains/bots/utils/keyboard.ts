import type { BotKeyboard } from '../types/bots.types';

/** The user's choice for the active action menu of a channel. */
export type KeyboardMode = 'menu' | 'typing';

/** What the composer should render for a keyboard in a given state. */
export interface KeyboardView {
	/** The button grid replaces the composer's input area. */
	showMenu: boolean;
	/** A small toggle in the composer brings the menu back. */
	showToggle: boolean;
}

/** A stable identity for a keyboard, so a changed menu is a new menu (it reappears after being dismissed). */
export function keyboardSignature(k: BotKeyboard): string {
	return JSON.stringify([k.bot_id, k.rows.map((r) => r.map((b) => [b.label, b.custom_id]))]);
}

/**
 * Picks the keyboard to show when several bots set one: the first. A channel rarely has two; the server keeps one
 * per bot and the order is stable.
 */
export function pickActiveKeyboard(keyboards: BotKeyboard[] | undefined): BotKeyboard | null {
	return keyboards && keyboards.length > 0 ? keyboards[0] : null;
}

/**
 * Decides what the composer shows.
 *
 * - A new keyboard opens as the menu (`mode` undefined).
 * - The user can switch to typing; a `persistent` keyboard keeps a toggle to switch back, others stay closed until
 *   the bot sends a different keyboard.
 * - A `one_time` keyboard closes after a key press (the caller sets `typing`); persistence still decides the toggle.
 *
 * @param keyboard - The active keyboard, or null.
 * @param mode - The user's choice for this keyboard, if any.
 */
export function keyboardView(keyboard: BotKeyboard | null, mode: KeyboardMode | undefined): KeyboardView {
	if (!keyboard) return { showMenu: false, showToggle: false };
	const open = mode !== 'typing';
	return { showMenu: open, showToggle: !open && keyboard.persistent === true };
}
