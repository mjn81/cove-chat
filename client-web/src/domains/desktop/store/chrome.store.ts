import { create } from 'zustand';

interface DesktopChromeState {
	/**
	 * True while the main chat shell is on screen. On macOS the shell lays the traffic lights into its own left
	 * column (like Telegram), so the separate title bar steps aside; every other screen keeps the bar.
	 */
	inAppShell: boolean;
	setInAppShell: (inAppShell: boolean) => void;
}

/** UI state shared between the desktop title bar and the screens that draw their own window chrome. */
export const useDesktopChromeStore = create<DesktopChromeState>((set) => ({
	inAppShell: false,
	setInAppShell: (inAppShell) => set({ inAppShell }),
}));
