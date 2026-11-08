/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import fa from '@/i18n/locales/fa.json';
import ar from '@/i18n/locales/ar.json';

/** Files that produce `ThemeIssue` codes. */
const SOURCES = ['utils/covetheme.ts', 'utils/tokens.ts', 'utils/zip-reader.ts', 'api/theme-library.ts'];

/** Every code literal passed to `fail(...)`, `failWith`, `{ code: '...' }` or `ctx.errors.push`. */
function emittedCodes(): string[] {
	const found = new Set<string>();
	for (const file of SOURCES) {
		const text = readFileSync(join(__dirname, '..', file), 'utf8');
		for (const m of text.matchAll(/code: '([a-z_]+)'/g)) found.add(m[1]);
		for (const m of text.matchAll(/\bfail\('([a-z_]+)'/g)) found.add(m[1]);
	}
	return [...found].sort();
}

describe('every issue code the validator can emit has a message in en, fa and ar', () => {
	const codes = emittedCodes();

	it('finds the codes (guards the scan itself)', () => {
		expect(codes.length).toBeGreaterThan(40);
		expect(codes).toContain('zip_symlink');
		expect(codes).toContain('low_contrast');
	});

	it.each([
		['en', en],
		['fa', fa],
		['ar', ar],
	])('%s', (_lang, locale) => {
		const issues = (locale as { themes: { issues: Record<string, string> } }).themes.issues;
		expect(codes.filter((c) => !(c in issues))).toEqual([]);
	});
});
