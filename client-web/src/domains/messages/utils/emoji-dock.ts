/** Width of the docked emoji and sticker column in px. */
export const DOCK_WIDTH = 340;

/** The window must be at least this wide for the dock: the chat column keeps room beside the sidebars. */
export const DOCK_MIN_WIDTH = 1100;

/** Media query form of {@link DOCK_MIN_WIDTH}. */
export const DOCK_MIN_WIDTH_QUERY = `(min-width: ${DOCK_MIN_WIDTH}px)`;

/**
 * Whether the docked panel should show: the user chose dock mode, the window is wide enough, and it is open.
 *
 * @param mode - Saved panel mode.
 * @param open - Saved dock open state.
 * @param wide - Window wide enough to dock.
 */
export function isDockVisible(mode: 'popover' | 'dock', open: boolean, wide: boolean): boolean {
	return mode === 'dock' && open && wide;
}

/**
 * What the emoji button does: toggle the dock when docked mode is usable, otherwise toggle the popover.
 *
 * @param mode - Saved panel mode.
 * @param wide - Window wide enough to dock.
 */
export function emojiButtonTarget(mode: 'popover' | 'dock', wide: boolean): 'dock' | 'popover' {
	return mode === 'dock' && wide ? 'dock' : 'popover';
}
