import {
	GetLockStatus,
	Lock,
	RemovePasscode,
	SetAutoLock,
	SetPasscode,
	Unlock,
} from '../../../wailsjs/go/main/App';
import type { LockStatus } from '../types/security.types';

/** Status reported when the shell cannot be reached (browser build): nothing to lock. */
export const NO_LOCK: LockStatus = { enabled: false, locked: false, auto_lock_minutes: 0, secure_storage: true };

/** Reads the passcode lock state from the desktop shell. */
export async function getLockStatus(): Promise<LockStatus> {
	try {
		return { ...NO_LOCK, ...(JSON.parse(await GetLockStatus()) as Partial<LockStatus>) };
	} catch {
		return NO_LOCK;
	}
}

/** @throws Error with the shell's message (wrong passcode, too many attempts). */
export const unlockApp = (passcode: string): Promise<void> => Unlock(passcode);

/** Locks now; the shell then asks the web layer to reload. */
export const lockApp = (): Promise<void> => Lock();

/** Sets a passcode, or changes it when one exists (`current` is then required). */
export const setPasscode = (current: string, next: string): Promise<void> => SetPasscode(current, next);

/** Turns the passcode off after verifying `current`. */
export const removePasscode = (current: string): Promise<void> => RemovePasscode(current);

/** Idle minutes before the app locks itself; 0 disables auto-lock. */
export const setAutoLock = (minutes: number): Promise<void> => SetAutoLock(minutes);
