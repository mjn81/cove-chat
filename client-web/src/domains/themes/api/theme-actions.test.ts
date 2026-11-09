import { describe, expect, it, vi } from 'vitest';
import { buildCoveTheme } from '../utils/covetheme';
import { getBuiltinTheme } from '../data/builtin-themes';
import { applyFromFile } from './theme-actions';
import type { ThemeStore } from './theme-library';
import type { InstalledTheme } from '../types/themes.types';

function memoryStore(): ThemeStore & { rows: Map<string, InstalledTheme> } {
	const rows = new Map<string, InstalledTheme>();
	return {
		rows,
		list: async () => [...rows.values()],
		get: async (id) => rows.get(id),
		put: async (row) => void rows.set(row.id, row),
		delete: async (id) => void rows.delete(id),
	};
}

describe('applyFromFile', () => {
	it('installs the theme, then selects it', async () => {
		const store = memoryStore();
		const select = vi.fn();
		const bytes = buildCoveTheme({ ...getBuiltinTheme('nord')!, id: 'shared-look' });
		// jsdom has no image decoder; this theme has no images so none is asked for.
		expect(await applyFromFile(bytes, store, select)()).toBe(true);
		expect(store.rows.has('shared-look')).toBe(true);
		expect(select).toHaveBeenCalledOnce();
		expect(select.mock.calls[0][0].id).toBe('shared-look');
	});

	it('neither installs nor selects a file that fails validation', async () => {
		const store = memoryStore();
		const select = vi.fn();
		expect(await applyFromFile(new Uint8Array([1, 2, 3]), store, select)()).toBe(false);
		expect(store.rows.size).toBe(0);
		expect(select).not.toHaveBeenCalled();
	});
});
