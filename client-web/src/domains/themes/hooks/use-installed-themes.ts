import { useLiveQuery } from 'dexie-react-hooks';
import { dexieThemeStore } from '../api/dexie-theme-store';
import type { InstalledTheme } from '../types/themes.types';

/**
 * The themes installed on this device, newest last. Re-renders when one is added or removed.
 *
 * @returns The rows, or an empty list while the first read (or an unavailable IndexedDB) is pending.
 */
export function useInstalledThemes(): InstalledTheme[] {
	return useLiveQuery(() => dexieThemeStore.list().catch(() => []), []) ?? [];
}
