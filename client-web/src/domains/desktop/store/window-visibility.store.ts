import { create } from 'zustand';

interface WindowVisibilityState {
	/** True while the desktop window is hidden in the tray (the app keeps running). */
	hidden: boolean;
	setHidden: (hidden: boolean) => void;
}

/** Whether the desktop window is hidden to the tray; the Go side reports changes (see useWindowVisibility). */
export const useWindowVisibilityStore = create<WindowVisibilityState>((set) => ({
	hidden: false,
	setHidden: (hidden) => set({ hidden }),
}));
