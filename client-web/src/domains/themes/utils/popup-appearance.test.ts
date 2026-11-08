import { beforeEach, describe, expect, it } from 'vitest';
import { COVE_TOKENS, getBuiltinTheme } from '../data/builtin-themes';
import { activeAppearance, applyTokenMap } from './popup-appearance';
import { THEME_TOKEN_NAMES } from './tokens';

describe('activeAppearance', () => {
	it('sends no tokens for Cove so the popup keeps the stylesheet palette', () => {
		expect(activeAppearance('cove', null, 'dark')).toEqual({ dark: true, tokens: {} });
		expect(activeAppearance('cove', null, 'light')).toEqual({ dark: false, tokens: {} });
	});

	it('sends the complete resolved token set of another theme', () => {
		const nord = getBuiltinTheme('nord')!;
		const a = activeAppearance('nord', null, 'light');
		expect(a.dark).toBe(false);
		expect(Object.keys(a.tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
		expect(a.tokens.background).toBe(nord.light!.background);
	});

	it('reports dark for a dark-only theme even when the user prefers light', () => {
		expect(activeAppearance('dracula', null, 'light').dark).toBe(true);
	});
});

describe('applyTokenMap', () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement('html');
	});

	it('sets valid allow-listed tokens', () => {
		const n = applyTokenMap(root, { primary: '10 20% 30%', background: '#ffffff' });
		expect(n).toBe(2);
		expect(root.style.getPropertyValue('--primary')).toBe('10 20% 30%');
		expect(root.style.getPropertyValue('--background')).toBe('0 0% 100%');
	});

	it('ignores unknown names and non-grammar values', () => {
		const n = applyTokenMap(root, { primary: 'red; x: url(//e)', radius: '0', 'font-family': 'x', ring: '1 1% 1%' });
		expect(n).toBe(1);
		expect(root.style.getPropertyValue('--primary')).toBe('');
		expect(root.style.getPropertyValue('--radius')).toBe('');
		expect(root.style.getPropertyValue('--ring')).toBe('1 1% 1%');
	});

	it('clears earlier overrides, so a notification with the default look resets the popup', () => {
		applyTokenMap(root, { ...COVE_TOKENS.dark });
		applyTokenMap(root, undefined);
		expect(root.style.length).toBe(0);
	});
});
