import { describe, expect, it } from 'vitest';
import { getBuiltinTheme } from '../data/builtin-themes';
import type { ThemeDefinition } from '../types/themes.types';
import { backgroundAfterThemeChange, normalizeThemeSettings } from './theme-settings';

const custom: ThemeDefinition = {
	id: 'my-theme',
	name: { en: 'Mine' },
	base: 'dark',
	tokens: { ...getBuiltinTheme('nord')!.tokens },
	chat: { background: { type: 'color', color: '220 16% 20%' } },
};

describe('normalizeThemeSettings: legacy settings keep working', () => {
	it('maps the old `theme` field to mode and keeps Cove', () => {
		expect(normalizeThemeSettings({ theme: 'light', chatBackground: 'space' })).toEqual({
			mode: 'light',
			themeId: 'cove',
			customTheme: null,
			chatBackground: 'space',
		});
		expect(normalizeThemeSettings({ theme: 'dark' }).mode).toBe('dark');
	});

	it('defaults for empty, missing or hostile input', () => {
		const dflt = { mode: 'dark', themeId: 'cove', customTheme: null, chatBackground: 'none' };
		expect(normalizeThemeSettings(undefined)).toEqual(dflt);
		expect(normalizeThemeSettings(null)).toEqual(dflt);
		expect(normalizeThemeSettings('x')).toEqual(dflt);
		expect(normalizeThemeSettings({ theme: 'purple', mode: 5, chatBackground: 'nope' })).toEqual(dflt);
	});

	it('prefers the new `mode` over the legacy `theme`', () => {
		expect(normalizeThemeSettings({ theme: 'dark', mode: 'light' }).mode).toBe('light');
	});
});

describe('normalizeThemeSettings: theme selection', () => {
	it('keeps a built-in id and discards any stored copy', () => {
		const r = normalizeThemeSettings({ mode: 'dark', themeId: 'nord', customTheme: custom });
		expect(r.themeId).toBe('nord');
		expect(r.customTheme).toBeNull();
	});

	it('keeps a valid installed theme snapshot', () => {
		const r = normalizeThemeSettings({ mode: 'dark', themeId: 'my-theme', customTheme: custom, chatBackground: 'theme' });
		expect(r.themeId).toBe('my-theme');
		expect(r.customTheme).toEqual(custom);
		expect(r.chatBackground).toBe('theme');
	});

	it('falls back to Cove when the snapshot is missing, mismatched or no longer valid', () => {
		expect(normalizeThemeSettings({ themeId: 'my-theme' }).themeId).toBe('cove');
		expect(normalizeThemeSettings({ themeId: 'other-theme', customTheme: custom }).themeId).toBe('cove');
		const broken = { ...custom, tokens: { ...custom.tokens, primary: 'url(x)' } };
		expect(normalizeThemeSettings({ themeId: 'my-theme', customTheme: broken }).themeId).toBe('cove');
	});

	it('resets the "theme" chat background when the theme has none', () => {
		expect(normalizeThemeSettings({ themeId: 'nord', chatBackground: 'theme' }).chatBackground).toBe('none');
	});
});

describe('backgroundAfterThemeChange', () => {
	it('adopts the theme background when the theme brings one', () => {
		expect(backgroundAfterThemeChange('space', custom)).toBe('theme');
	});

	it('drops a stale "theme" choice, keeps a patterned one', () => {
		expect(backgroundAfterThemeChange('theme', getBuiltinTheme('nord')!)).toBe('none');
		expect(backgroundAfterThemeChange('space', getBuiltinTheme('nord')!)).toBe('space');
	});
});
