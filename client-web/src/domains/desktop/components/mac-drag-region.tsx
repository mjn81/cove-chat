import { isMacDesktop } from '../utils/is-mac-desktop';
import { MAC_LIGHTS_ZONE } from '../utils/titlebar-layout';

/**
 * Blank, draggable strip at the top of the left column that holds the macOS traffic lights, so they sit inside
 * the UI the way Telegram's do. Renders nothing elsewhere.
 */
export function MacLightsSpacer() {
	if (!isMacDesktop()) return null;
	return <div aria-hidden className="desktop-drag shrink-0" style={{ height: MAC_LIGHTS_ZONE }} />;
}

/**
 * Invisible drag handle along the top edge of a screen with no top bar of its own (for example the empty chat
 * view), so the window can still be moved from there. Renders nothing outside the macOS desktop app.
 */
export function MacDragStrip() {
	if (!isMacDesktop()) return null;
	return <div aria-hidden className="desktop-drag absolute inset-x-0 top-0 z-10" style={{ height: MAC_LIGHTS_ZONE }} />;
}
