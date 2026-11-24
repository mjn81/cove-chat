import { describe, expect, it } from 'vitest';
import { validateThemeJson } from './covetheme';
import { validThemeJson } from './covetheme.fixtures';
import { BUILTIN_THEMES } from '../data/builtin-themes';

describe('Russian theme names', () => {
	it('keeps an optional `ru` name from theme.json without warnings', () => {
		const result = validateThemeJson(validThemeJson({ name: { en: 'Test theme', ru: 'Тестовая тема' } }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.theme.name.ru).toBe('Тестовая тема');
		expect(result.warnings).toEqual([]);
	});

	it('every built-in theme has a Russian name', () => {
		expect(BUILTIN_THEMES.filter((t) => !t.name.ru).map((t) => t.id)).toEqual([]);
	});
});
