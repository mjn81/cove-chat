import { describe, expect, it } from 'vitest';
import { COVE_TOKENS, getBuiltinTheme } from '../data/builtin-themes';
import type { ThemeAsset } from '../types/themes.types';
import { buildCoveTheme, parseCoveTheme } from './covetheme';
import {
	addLightVariant,
	draftAssets,
	draftFromTheme,
	draftIssues,
	draftToTheme,
	newThemeId,
	setDraftBackground,
	setDraftImage,
	setDraftToken,
	tokensOf,
} from './theme-draft';

const nord = getBuiltinTheme('nord')!;
const dracula = getBuiltinTheme('dracula')!;

/** A tiny but header-valid PNG. */
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0,
]);
const asset: ThemeAsset = { mime: 'image/png', bytes: PNG, width: 4, height: 4 };

describe('newThemeId', () => {
	it('makes a valid slug with a random suffix', () => {
		expect(newThemeId('My Cool Theme!', () => 0.123456)).toMatch(/^my-cool-theme-[a-z0-9]{4,}$/);
	});

	it('copes with names that have no latin letters', () => {
		expect(newThemeId('پوسته', () => 0.5)).toMatch(/^theme-[a-z0-9]{4,}$/);
	});
});

describe('draftFromTheme', () => {
	it('copies a theme into a complete editable draft with a fresh id', () => {
		const d = draftFromTheme(nord, {}, { asCopy: true, random: () => 0.3 });
		expect(d.id).not.toBe('nord');
		expect(d.id).toMatch(/^nord-[a-z0-9]+$/);
		expect(d.base).toBe('dark');
		expect(d.tokens).toEqual({ ...COVE_TOKENS.dark, ...nord.tokens });
		expect(d.light).not.toBeNull();
	});

	it('keeps the id when editing an installed theme', () => {
		const installed = { ...nord, id: 'my-nord' };
		expect(draftFromTheme(installed, {}, { asCopy: false }).id).toBe('my-nord');
	});

	it('has no light variant for a light-base or single-variant theme', () => {
		expect(draftFromTheme(dracula, {}, { asCopy: true }).light).toBeNull();
	});
});

describe('editing', () => {
	it('sets a token on the chosen variant without mutating the draft', () => {
		const d = draftFromTheme(nord, {}, { asCopy: true });
		const next = setDraftToken(d, 'base', 'primary', '10 50% 50%');
		expect(tokensOf(next, 'base').primary).toBe('10 50% 50%');
		expect(tokensOf(d, 'base').primary).toBe(nord.tokens.primary);
		const light = setDraftToken(d, 'light', 'primary', '20 50% 40%');
		expect(tokensOf(light, 'light').primary).toBe('20 50% 40%');
		expect(tokensOf(light, 'base').primary).toBe(nord.tokens.primary);
	});

	it('canonicalises and refuses bad colour input', () => {
		const d = draftFromTheme(nord, {}, { asCopy: true });
		expect(tokensOf(setDraftToken(d, 'base', 'primary', '#ff0000'), 'base').primary).toBe('0 100% 50%');
		expect(setDraftToken(d, 'base', 'primary', 'red; evil')).toBe(d);
	});

	it('adds a light variant only to dark themes, starting from Cove light', () => {
		const d = draftFromTheme(dracula, {}, { asCopy: true });
		const withLight = addLightVariant(d);
		expect(withLight.light).toEqual(COVE_TOKENS.light);
		const lightBase = { ...d, base: 'light' as const };
		expect(addLightVariant(lightBase)).toBe(lightBase);
	});

	it('drops an image background that has no image', () => {
		const d = setDraftBackground(draftFromTheme(nord, {}, { asCopy: true }), {
			type: 'image',
			asset: 'assets/background.png',
			opacity: 1,
			blur: 0,
			fit: 'cover',
		});
		expect(draftToTheme(d).chat?.background).toBeUndefined();
		expect(draftAssets(d)).toEqual({});
	});

	it('names the image path after its type', () => {
		const d = setDraftImage(draftFromTheme(nord, {}, { asCopy: true }), asset);
		expect(d.background).toMatchObject({ type: 'image', asset: 'assets/background.png' });
		expect(draftAssets(d)).toEqual({ 'assets/background.png': asset });
		expect(draftToTheme(d).chat?.background).toMatchObject({ type: 'image', asset: 'assets/background.png' });
	});
});

describe('draftIssues', () => {
	it('is clean for a good palette', () => {
		expect(draftIssues(draftFromTheme(nord, {}, { asCopy: true })).errors).toEqual([]);
	});

	it('reports unreadable text as an error and an empty name', () => {
		let d = draftFromTheme(nord, {}, { asCopy: true });
		d = setDraftToken(d, 'base', 'foreground', tokensOf(d, 'base').background);
		d = { ...d, name: { en: '  ' } };
		const codes = draftIssues(d).errors.map((e) => e.code);
		expect(codes).toContain('low_contrast');
		expect(codes).toContain('invalid_name');
	});
});

describe('export round trip', () => {
	it('parses back to an equal theme', () => {
		let d = draftFromTheme(dracula, {}, { asCopy: true, random: () => 0.7 });
		d = { ...d, name: { en: 'Round Trip' }, author: 'Sam', license: 'CC0-1.0' };
		d = setDraftToken(d, 'base', 'primary', '12 80% 60%');
		d = setDraftBackground(d, { type: 'gradient', from: '230 20% 14%', to: '230 20% 20%', angle: 45 });
		const theme = draftToTheme(d);
		const parsed = parseCoveTheme(buildCoveTheme(theme, draftAssets(d)));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.theme).toEqual(theme);
	});

	it('keeps the image and its bytes', () => {
		const d = setDraftImage(draftFromTheme(nord, {}, { asCopy: true, random: () => 0.1 }), asset);
		const parsed = parseCoveTheme(buildCoveTheme(draftToTheme(d), draftAssets(d)));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.assets['assets/background.png'].bytes).toEqual(PNG);
			expect(parsed.theme).toEqual(draftToTheme(d));
		}
	});

	it('carries both variants', () => {
		const d = draftFromTheme(nord, {}, { asCopy: true });
		const parsed = parseCoveTheme(buildCoveTheme(draftToTheme(d), {}));
		expect(parsed.ok && parsed.theme.light).toEqual({ ...COVE_TOKENS.light, ...nord.light });
	});
});
