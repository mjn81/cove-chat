import { describe, expect, it } from 'vitest';
import { localizedThemeName } from './theme-name';

describe('localizedThemeName', () => {
	const name = { en: 'Nord', fa: 'نُرد', ar: 'نورد' };

	it('picks the UI language', () => {
		expect(localizedThemeName(name, 'fa')).toBe('نُرد');
		expect(localizedThemeName(name, 'ar-SA')).toBe('نورد');
		expect(localizedThemeName(name, 'en-US')).toBe('Nord');
	});

	it('falls back to English', () => {
		expect(localizedThemeName({ en: 'Only' }, 'fa')).toBe('Only');
		expect(localizedThemeName(name, 'de')).toBe('Nord');
	});
});
