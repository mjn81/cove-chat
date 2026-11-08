import { db } from '@/lib/db';
import type { ThemeStore } from './theme-library';

/** Installed themes in the app's IndexedDB (`CoveDB.themes`). */
export const dexieThemeStore: ThemeStore = {
	list: () => db.themes.orderBy('installed_at').toArray(),
	get: (id) => db.themes.get(id),
	put: async (row) => {
		await db.themes.put(row);
	},
	delete: (id) => db.themes.delete(id),
};
