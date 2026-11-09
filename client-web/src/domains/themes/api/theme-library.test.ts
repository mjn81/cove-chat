import { describe, expect, it, vi } from 'vitest';
import { getBuiltinTheme } from '../data/builtin-themes';
import type { InstalledTheme } from '../types/themes.types';
import { buildCoveTheme, parseCoveTheme } from '../utils/covetheme';
import { makePng, rawZip, themeJsonEntry, validThemeJson } from '../utils/covetheme.fixtures';
import {
	MAX_INSTALLED_THEMES,
	deleteInstalledTheme,
	exportThemeFile,
	installThemeFromBytes,
	type ThemeStore,
} from './theme-library';

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

const themeBytes = (patch: Record<string, unknown> = {}) => rawZip([themeJsonEntry(validThemeJson(patch))]);
const decodeOk = async () => true;

describe('installThemeFromBytes', () => {
	it('stores a valid theme and reports it', async () => {
		const store = memoryStore();
		const r = await installThemeFromBytes(themeBytes(), store, { canDecode: decodeOk });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.replaced).toBe(false);
		expect(store.rows.get('test-theme')?.definition.name.en).toBe('Test theme');
	});

	it('surfaces validation errors without storing anything', async () => {
		const store = memoryStore();
		const r = await installThemeFromBytes(new Uint8Array(10), store, { canDecode: decodeOk });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe('zip_invalid');
		expect(store.rows.size).toBe(0);
	});

	it('refuses ids that belong to a built-in theme', async () => {
		const store = memoryStore();
		const r = await installThemeFromBytes(themeBytes({ id: 'nord' }), store, { canDecode: decodeOk });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe('reserved_id');
		expect(store.rows.size).toBe(0);
	});

	it('replaces an installed theme with the same id', async () => {
		const store = memoryStore();
		await installThemeFromBytes(themeBytes(), store, { canDecode: decodeOk });
		const r = await installThemeFromBytes(themeBytes({ name: { en: 'Renamed' } }), store, { canDecode: decodeOk });
		expect(r.ok && r.replaced).toBe(true);
		expect(store.rows.size).toBe(1);
		expect(store.rows.get('test-theme')?.definition.name.en).toBe('Renamed');
	});

	it('refuses images the browser cannot decode', async () => {
		const store = memoryStore();
		const bytes = rawZip([
			themeJsonEntry(validThemeJson({ chat: { background: { type: 'image', asset: 'assets/bg.png' } } })),
			{ name: 'assets/bg.png', data: makePng(10, 10) },
		]);
		const decode = vi.fn(async () => false);
		const r = await installThemeFromBytes(bytes, store, { canDecode: decode });
		expect(decode).toHaveBeenCalledTimes(1);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe('image_undecodable');
		expect(store.rows.size).toBe(0);
	});

	it('keeps the images with the theme', async () => {
		const store = memoryStore();
		const bytes = rawZip([
			themeJsonEntry(validThemeJson({ chat: { background: { type: 'image', asset: 'assets/bg.png' } } })),
			{ name: 'assets/bg.png', data: makePng(10, 10) },
		]);
		await installThemeFromBytes(bytes, store, { canDecode: decodeOk });
		expect(Object.keys(store.rows.get('test-theme')!.assets)).toEqual(['assets/bg.png']);
	});

	it('caps how many themes can be installed', async () => {
		const store = memoryStore();
		for (let i = 0; i < MAX_INSTALLED_THEMES; i++) {
			await store.put({ id: `theme-${i}`, definition: getBuiltinTheme('nord')!, assets: {}, installed_at: i });
		}
		const r = await installThemeFromBytes(themeBytes(), store, { canDecode: decodeOk });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe('too_many_themes');
	});
});

describe('deleteInstalledTheme', () => {
	it('removes the row', async () => {
		const store = memoryStore();
		await installThemeFromBytes(themeBytes(), store, { canDecode: decodeOk });
		await deleteInstalledTheme('test-theme', store);
		expect(store.rows.size).toBe(0);
	});
});

describe('exportThemeFile', () => {
	it('exports an installed theme with its images, readable by the parser', async () => {
		const store = memoryStore();
		const bytes = rawZip([
			themeJsonEntry(validThemeJson({ chat: { background: { type: 'image', asset: 'assets/bg.png' } } })),
			{ name: 'assets/bg.png', data: makePng(10, 10) },
		]);
		await installThemeFromBytes(bytes, store, { canDecode: decodeOk });
		const file = await exportThemeFile(store.rows.get('test-theme')!.definition, store);
		expect(file.fileName).toBe('test-theme.covetheme');
		const again = parseCoveTheme(file.bytes);
		expect(again.ok && Object.keys(again.assets)).toEqual(['assets/bg.png']);
	});

	it('exports a built-in under a new id so it can be installed as a copy', async () => {
		const file = await exportThemeFile(getBuiltinTheme('nord')!, memoryStore());
		const parsed = parseCoveTheme(file.bytes);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.theme.id).toBe('nord-copy');
			expect(parsed.theme.tokens).toEqual(getBuiltinTheme('nord')!.tokens);
		}
		expect(file.fileName).toBe('nord-copy.covetheme');
	});

	it('produces a file identical in content to buildCoveTheme', async () => {
		const t = getBuiltinTheme('paper')!;
		const file = await exportThemeFile(t, memoryStore());
		const direct = buildCoveTheme({ ...t, id: 'paper-copy' });
		expect(file.bytes).toEqual(direct);
	});
});
