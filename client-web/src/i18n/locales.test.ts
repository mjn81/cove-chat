import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import fa from './locales/fa.json';
import ar from './locales/ar.json';
import { RTL_LANGUAGES } from './index';

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

describe('RTL language set', () => {
	it('does NOT include Farsi — only translated text should change, not layout direction', () => {
		expect(RTL_LANGUAGES.has('fa')).toBe(false);
	});

	it('still includes Arabic', () => {
		expect(RTL_LANGUAGES.has('ar')).toBe(true);
	});
});
