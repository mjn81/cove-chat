import { useLiveQuery } from 'dexie-react-hooks';
import { dexieThemeStore } from '../api/dexie-theme-store';
import type { InstalledTheme } from '../types/themes.types';
import { revalidateThemeDefinition } from '../utils/covetheme';

/**
 * The themes installed on this device, newest last. Re-renders when one is added or removed. Rows are re-validated
 * on the way out, so a tampered IndexedDB entry is skipped instead of reaching the UI.
 *
 * @returns The rows, or an empty list while the first read (or an unavailable IndexedDB) is pending.
 */
export function useInstalledThemes(): InstalledTheme[] {
	const rows = useLiveQuery(() => dexieThemeStore.list().catch(() => [] as InstalledTheme[]), []) ?? [];
	return rows.flatMap((row) => {
		const definition = revalidateThemeDefinition(row.definition);
		return definition ? [{ ...row, definition }] : [];
	});
}
