import { describe, expect, it } from 'vitest';
import { getBuiltinTheme } from '../data/builtin-themes';
import type { InstalledTheme } from '../types/themes.types';
import { parseCoveTheme } from '../utils/covetheme';
import { draftFromTheme, setDraftToken } from '../utils/theme-draft';
import { draftToThemeFile, saveDraft } from './theme-draft-actions';
import type { ThemeStore } from './theme-library';

const dracula = getBuiltinTheme('dracula')!;
const canDecode = async () => true;

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

describe('saveDraft', () => {
	it('installs the draft as a new theme', async () => {
		const store = memoryStore();
		const draft = setDraftToken(draftFromTheme(dracula, {}, { asCopy: true, random: () => 0.4 }), 'base', 'primary', '12 80% 60%');
		const r = await saveDraft(draft, store, { canDecode });
		expect(r.ok).toBe(true);
		const row = store.rows.get(draft.id)!;
		expect(row.definition.tokens.primary).toBe('12 80% 60%');
	});

	it('replaces an installed theme when editing it', async () => {
		const store = memoryStore();
		const draft = draftFromTheme(dracula, {}, { asCopy: true });
		await saveDraft(draft, store, { canDecode });
		const r = await saveDraft({ ...draft, author: 'Me' }, store, { canDecode });
		expect(r).toMatchObject({ ok: true, replaced: true });
		expect(store.rows.size).toBe(1);
	});

	it('refuses a draft the validator would refuse and stores nothing', async () => {
		const store = memoryStore();
		let draft = draftFromTheme(dracula, {}, { asCopy: true });
		draft = setDraftToken(draft, 'base', 'foreground', draft.tokens.background);
		const r = await saveDraft(draft, store, { canDecode });
		expect(r.ok).toBe(false);
		expect(store.rows.size).toBe(0);
	});

	it('cannot take a built-in id', async () => {
		const store = memoryStore();
		const r = await saveDraft({ ...draftFromTheme(dracula, {}, { asCopy: true }), id: 'dracula' }, store, { canDecode });
		expect(r).toMatchObject({ ok: false, error: { code: 'reserved_id' } });
	});
});

describe('draftToThemeFile', () => {
	it('packs a file that parses back to the same theme', () => {
		const draft = draftFromTheme(dracula, {}, { asCopy: true, random: () => 0.9 });
		const file = draftToThemeFile(draft);
		expect(file.fileName).toBe(`${draft.id}.covetheme`);
		const parsed = parseCoveTheme(file.bytes);
		expect(parsed.ok).toBe(true);
	});
});
