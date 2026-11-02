import { create } from 'zustand';

import type { DesktopUpdateState } from '../types/update.types';

interface DesktopUpdateStore {
	/** Latest updater state pushed by the desktop shell; null until the first one arrives (and in a browser). */
	state: DesktopUpdateState | null;
	/** Version whose banner the user dismissed with "Later". */
	dismissedVersion: string | null;
	setState: (state: DesktopUpdateState) => void;
	dismiss: (version: string) => void;
}

/** Client-side mirror of the desktop auto-updater. The source of truth stays in Go; this only holds what to draw. */
export const useDesktopUpdateStore = create<DesktopUpdateStore>((set) => ({
	state: null,
	dismissedVersion: null,
	setState: (state) => set({ state }),
	dismiss: (version) => set({ dismissedVersion: version }),
}));
