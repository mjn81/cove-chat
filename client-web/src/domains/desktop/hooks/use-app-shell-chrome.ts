import { useEffect } from 'react';
import { useDesktopChromeStore } from '../store/chrome.store';

/**
 * Tells the title bar that the chat shell (with its own room for the traffic lights) is on screen, so it can step
 * aside on macOS, for as long as the calling component is mounted and `active` is true. Pass false for layouts
 * that have no such room, such as the single-column phone-width view.
 */
export function useAppShellChrome(active: boolean): void {
	const setInAppShell = useDesktopChromeStore((s) => s.setInAppShell);
	useEffect(() => {
		setInAppShell(active);
		return () => setInAppShell(false);
	}, [active, setInAppShell]);
}
