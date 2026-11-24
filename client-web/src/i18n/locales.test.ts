import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import fa from './locales/fa.json';
import ar from './locales/ar.json';
import ru from './locales/ru.json';
import i18n, { RTL_LANGUAGES } from './index';

// Regression guard for the translation-completeness finding: fa/ar previously
// silently fell back to raw English/keys for an entire settings.* section
// (account deletion, password change, etc.) because they were missing those
// keys outright.

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
	return Object.entries(obj).flatMap(([k, v]) => {
		const key = prefix ? `${prefix}.${k}` : k;
		return v && typeof v === 'object' && !Array.isArray(v)
			? flattenKeys(v as Record<string, unknown>, key)
			: [key];
	});
}

const enKeys = new Set(flattenKeys(en));
const faKeys = new Set(flattenKeys(fa));
const arKeys = new Set(flattenKeys(ar));
const ruKeys = new Set(flattenKeys(ru));

/** CLDR plural suffixes Russian needs; i18next appends them to the English key. */
const RU_PLURAL_SUFFIX = /_(one|few|many|other)$/;

/** Keys whose `{{count}}` is followed by a noun, so Russian needs all four forms. */
const RU_PLURAL_KEYS = ['sidebar.members_count', 'chat.members', 'chat.forward.members', 'channel.invite.preview.members', 'chat.selection.delete_title'];

describe('translation completeness', () => {
	it('fa.json has every key that en.json has', () => {
		const missing = [...enKeys].filter((k) => !faKeys.has(k));
		expect(missing).toEqual([]);
	});

	it('ar.json has every key that en.json has', () => {
		const missing = [...enKeys].filter((k) => !arKeys.has(k));
		expect(missing).toEqual([]);
	});

	it('fa.json and ar.json have no stray keys beyond en.json', () => {
		expect([...faKeys].filter((k) => !enKeys.has(k))).toEqual([]);
		expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([]);
	});
});

describe('Russian translation', () => {
	it('has every key that en.json has', () => {
		expect([...enKeys].filter((k) => !ruKeys.has(k))).toEqual([]);
	});

	it('only adds plural variants of existing keys', () => {
		const stray = [...ruKeys].filter((k) => !enKeys.has(k) && !(RU_PLURAL_SUFFIX.test(k) && enKeys.has(k.replace(RU_PLURAL_SUFFIX, ''))));
		expect(stray).toEqual([]);
	});

	it.each(RU_PLURAL_KEYS)('%s has one/few/many/other forms', (key) => {
		expect(['one', 'few', 'many', 'other'].filter((s) => !ruKeys.has(`${key}_${s}`))).toEqual([]);
	});

	it.each([
		[1, '1 участник'],
		[3, '3 участника'],
		[5, '5 участников'],
		[11, '11 участников'],
		[21, '21 участник'],
		[0, '0 участников'],
	])('resolves the plural form for %i', (count, expected) => {
		expect(i18n.getFixedT('ru')('chat.members', { count })).toBe(expected);
	});

	it('is left-to-right', () => {
		expect(RTL_LANGUAGES.has('ru')).toBe(false);
	});
});

describe('RTL language set', () => {
	it('does NOT include Farsi — only translated text should change, not layout direction', () => {
		expect(RTL_LANGUAGES.has('fa')).toBe(false);
	});

	it('still includes Arabic', () => {
		expect(RTL_LANGUAGES.has('ar')).toBe(true);
	});
});
