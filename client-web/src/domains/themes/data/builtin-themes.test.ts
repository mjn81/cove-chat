/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../utils/color';
import { buildCoveTheme, parseCoveTheme } from '../utils/covetheme';
import { CORE_TOKEN_NAMES, THEME_TOKEN_NAMES, checkReadability, sanitizeTokens } from '../utils/tokens';
import { resolveTheme } from '../utils/resolve-theme';
import { BUILTIN_THEMES, COVE_TOKENS, DEFAULT_THEME_ID, getBuiltinTheme, isBuiltinThemeId } from './builtin-themes';
import type { PartialTokenSet, ThemeMode } from '../types/themes.types';

/** Every (theme, variant) with its token set. */
const VARIANTS = BUILTIN_THEMES.flatMap((t) => {
	const out: Array<[string, PartialTokenSet]> = [[`${t.id}/${t.base}`, t.tokens]];
	if (t.light) out.push([`${t.id}/light`, t.light]);
	return out;
});

describe('built-in registry', () => {
	it('ships the eleven planned themes with Cove first and the default', () => {
		expect(BUILTIN_THEMES.map((t) => t.id)).toEqual([
			'cove', 'violet-night', 'skyline', 'crimson', 'nord', 'catppuccin', 'dracula', 'solarized', 'gruvbox', 'amoled-black', 'paper',
		]);
		expect(DEFAULT_THEME_ID).toBe('cove');
		expect(getBuiltinTheme('nord')?.name.en).toBe('Nord');
		expect(isBuiltinThemeId('cove')).toBe(true);
		expect(isBuiltinThemeId('mine')).toBe(false);
	});

	it('uses neutral names: no brand names and no logos', () => {
		const banned = /discord|telegram|youtube|twitter|whatsapp|google|facebook/i;
		for (const t of BUILTIN_THEMES) {
			expect(Object.values(t.name).join(' ')).not.toMatch(banned);
		}
	});

	it('has an en, fa and ar name for each', () => {
		for (const t of BUILTIN_THEMES) {
			expect(t.name.en && t.name.fa && t.name.ar).toBeTruthy();
		}
	});

	it('has unique ids that fit the .covetheme id grammar', () => {
		const ids = BUILTIN_THEMES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
	});
});

/**
 * Cove is the shipped look and must stay byte-for-byte what it was, so its two known sub-AA pairs (white on the
 * light terracotta primary at 4.0:1, white on the dark destructive red) are grandfathered at the hard minimum of 3:1.
 * Every other built-in is held to full AA.
 */
const GRANDFATHERED = (name: string) => name.startsWith('cove/');
const AA = (name: string) => (GRANDFATHERED(name) ? 3 : 4.5);

describe.each(VARIANTS)('%s', (name, tokens) => {
	it('defines every token with a canonical value and nothing else', () => {
		expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
		const r = sanitizeTokens(tokens);
		expect(r.errors).toEqual([]);
		expect(r.warnings).toEqual([]);
		expect(r.tokens).toEqual(tokens);
	});

	it('passes the readability guard (no warnings except the grandfathered Cove pairs)', () => {
		const r = checkReadability(tokens);
		expect(r.errors).toEqual([]);
		if (!GRANDFATHERED(name)) expect(r.warnings).toEqual([]);
	});

	it('meets WCAG AA (4.5:1) for text on background, card and primary', () => {
		const t = tokens as Record<string, string>;
		expect(contrastRatio(t.foreground, t.background)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(t['card-foreground'], t.card)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(t['popover-foreground'], t.popover)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(t['primary-foreground'], t.primary)).toBeGreaterThanOrEqual(AA(name));
	});

	it('keeps secondary text and the accent state readable', () => {
		const t = tokens as Record<string, string>;
		expect(contrastRatio(t['muted-foreground'], t.background)).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(t['muted-foreground'], t.muted)).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(t['accent-foreground'], t.accent)).toBeGreaterThanOrEqual(AA(name));
		expect(contrastRatio(t['destructive-foreground'], t.destructive)).toBeGreaterThanOrEqual(3);
	});
});

describe('every built-in survives the .covetheme round trip', () => {
	it.each(BUILTIN_THEMES.map((t) => [t.id, t] as const))('%s', (_id, t) => {
		const parsed = parseCoveTheme(buildCoveTheme(t));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.theme).toEqual(t);
	});
});

describe('Cove matches index.css exactly (the stylesheet stays the source of the default look)', () => {
	const css = readFileSync(join(__dirname, '../../../index.css'), 'utf8');

	function block(selector: RegExp): Record<string, string> {
		const m = selector.exec(css);
		if (!m) throw new Error('block not found');
		const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index));
		const out: Record<string, string> = {};
		for (const line of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[line[1]] = line[2].replace(/\/\*.*?\*\//g, '').trim();
		return out;
	}

	it.each<[ThemeMode, RegExp]>([
		['dark', /:root,\s*\.dark\s*\{/],
		['light', /\n\s*\.light\s*\{/],
	])('%s', (mode, selector) => {
		const fromCss = block(selector);
		for (const name of THEME_TOKEN_NAMES) {
			expect(fromCss[name], `${mode} --${name}`).toBe(COVE_TOKENS[mode][name]);
		}
	});
});

describe('resolveTheme', () => {
	it('returns Cove tokens untouched in either mode', () => {
		const cove = getBuiltinTheme('cove')!;
		expect(resolveTheme(cove, 'dark')).toEqual({ mode: 'dark', tokens: COVE_TOKENS.dark });
		expect(resolveTheme(cove, 'light')).toEqual({ mode: 'light', tokens: COVE_TOKENS.light });
	});

	it('forces the only available look for single-variant themes', () => {
		expect(resolveTheme(getBuiltinTheme('dracula')!, 'light').mode).toBe('dark');
		expect(resolveTheme(getBuiltinTheme('paper')!, 'dark').mode).toBe('light');
	});

	it('fills omitted optional tokens from Cove of the effective mode', () => {
		const partial = { ...Object.fromEntries(CORE_TOKEN_NAMES.map((n) => [n, (COVE_TOKENS.dark as Record<string, string>)[n]])) } as PartialTokenSet;
		const r = resolveTheme({ id: 'x-theme', name: { en: 'X' }, base: 'dark', tokens: partial }, 'dark');
		expect(r.tokens.success).toBe(COVE_TOKENS.dark.success);
	});
});
