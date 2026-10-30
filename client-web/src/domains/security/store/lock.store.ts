import { create } from 'zustand';
import { isWails } from '@/utils/wails';
import { getLockStatus, NO_LOCK } from '../api/lock.api';
import type { LockStatus } from '../types/security.types';

interface LockState {
	status: LockStatus;
	/** True until the first status read finishes, so the app does not flash before knowing it is locked. */
	isLoading: boolean;
	/** Reads the current state from the shell. Safe to call anywhere; a no-op on the browser build. */
	refresh: () => Promise<LockStatus>;
}

/** Passcode lock state for the desktop app (always "no lock" in a browser). */
export const useLockStore = create<LockState>((set) => ({
	status: NO_LOCK,
	isLoading: isWails(),
	refresh: async () => {
		const status = isWails() ? await getLockStatus() : NO_LOCK;
		set({ status, isLoading: false });
		return status;
	},
}));
