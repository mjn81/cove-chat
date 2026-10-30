/**
 * Height of the zone macOS reserves for the traffic lights, in px. The native title bar is about 28 px, but
 * lights hugging the top edge of a 28 px strip look cramped, so Cove gives them a taller, quiet zone.
 */
export const MAC_LIGHTS_ZONE = 40;

/** Room left clear of content at the start of the Mac zone, wide enough for the three lights plus a margin. */
export const MAC_LIGHTS_INSET = 80;

/** Height of the Windows / Linux title bar, in px. */
export const FRAMED_BAR_HEIGHT = 28;

/** How the desktop title bar should look for the current platform and screen. */
export interface TitleBarLayout {
	/** Whether a bar takes space at the top of the window. */
	visible: boolean;
	/** Height in px (0 when hidden); published as `--titlebar-h` so full-height layouts subtract it. */
	height: number;
	/** Drawn in the page colour with no border, so it reads as part of the window rather than a strip. */
	blended: boolean;
	/** Minimise / maximise / close buttons (only where the OS draws none). */
	captionButtons: boolean;
	/** Space kept empty at the start of the bar for the macOS traffic lights. */
	lightsInset: number;
}

/**
 * Decides the title bar layout.
 *
 * macOS keeps its native traffic lights. Inside the chat shell they sit in the left column (see
 * `MacLightsSpacer`), so no bar is drawn; elsewhere a borderless bar in the page colour holds them. Windows and
 * Linux run frameless, so they always get the framed bar with its own caption buttons.
 *
 * @param args.mac whether the app runs on macOS.
 * @param args.inAppShell whether the main chat shell is showing.
 */
export function titleBarLayout({ mac, inAppShell }: { mac: boolean; inAppShell: boolean }): TitleBarLayout {
	if (!mac) {
		return { visible: true, height: FRAMED_BAR_HEIGHT, blended: false, captionButtons: true, lightsInset: 0 };
	}
	if (inAppShell) {
		return { visible: false, height: 0, blended: false, captionButtons: false, lightsInset: 0 };
	}
	return { visible: true, height: MAC_LIGHTS_ZONE, blended: true, captionButtons: false, lightsInset: MAC_LIGHTS_INSET };
}
