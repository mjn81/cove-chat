import { describe, expect, it } from 'vitest';
import i18n from '.';

describe('language preference', () => {
	it('is saved whenever the language changes, so it survives a reload', async () => {
		await i18n.changeLanguage('ru');
		expect(localStorage.getItem('cove_lang')).toBe('ru');
		await i18n.changeLanguage('en');
		expect(localStorage.getItem('cove_lang')).toBe('en');
	});
});
