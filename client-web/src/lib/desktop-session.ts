import { isWails } from '@/utils/wails';
import { ClearSession, GetSession, SaveSession } from '../wailsjs/go/main/App';

/**
 * The desktop session token, held in memory only. It is never written to localStorage: the durable copy lives in
 * the shell (OS keystore, optionally passcode-sealed), which hands it back at startup. A crash or a stolen
 * profile folder therefore never exposes a bearer token from web storage.
 */
let token: string | null = null;

/** The current desktop bearer token, or null when signed out or locked. */
export const getDesktopToken = (): string | null => token;

/** Sets the in-memory token without persisting it. */
export function setDesktopToken(next: string | null): void {
	token = next;
}

/**
 * Loads the saved token from the shell into memory.
 *
 * @returns whether the shell holds a session at all (false when signed out, locked or not on desktop)
 */
export async function loadDesktopSession(): Promise<boolean> {
	if (!isWails()) return false;
	try {
		// Older builds kept a plaintext copy here; remove it so it cannot linger on disk.
		localStorage.removeItem('cove_token');
	} catch {
		/* storage unavailable */
	}
	try {
		const saved = await GetSession();
		token = saved || null;
		return !!saved;
	} catch {
		return false;
	}
}

/** Keeps the token in memory and saves it to the shell's keystore. */
export function saveDesktopSession(next: string): void {
	token = next;
	SaveSession(next).catch(() => {});
}

/** Forgets the token everywhere (sign out). */
export function clearDesktopSession(): void {
	token = null;
	ClearSession().catch(() => {});
}
