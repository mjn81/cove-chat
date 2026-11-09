import { describe, expect, it } from 'vitest';
import { COVE_TOKENS, getBuiltinTheme } from '../data/builtin-themes';
import { contrastRatio } from './color';
import { autoFixTokens, contrastIssues, suggestForeground } from './contrast-fix';
import { MIN_CONTRAST_AA } from './tokens';

const lightnessOf = (triplet: string) => Number(triplet.split(' ')[2].replace('%', ''));

describe('suggestForeground', () => {
	it('keeps the hue and moves lightness until the target is met', () => {
		const fixed = suggestForeground('210 20% 45%', '210 20% 40%', MIN_CONTRAST_AA);
		expect(contrastRatio(fixed, '210 20% 40%')).toBeGreaterThanOrEqual(MIN_CONTRAST_AA);
		expect(fixed.startsWith('210 ')).toBe(true);
	});

	it('goes light on dark surfaces and dark on light ones', () => {
		expect(lightnessOf(suggestForeground('0 0% 30%', '0 0% 20%', 4.5))).toBeGreaterThan(30);
		expect(lightnessOf(suggestForeground('0 0% 70%', '0 0% 90%', 4.5))).toBeLessThan(70);
	});

	it('does better than the original when the hue cannot reach the target', () => {
		const fixed = suggestForeground('120 100% 50%', '120 100% 40%', 7);
		expect(contrastRatio(fixed, '120 100% 40%')).toBeGreaterThan(contrastRatio('120 100% 50%', '120 100% 40%'));
	});

	it('leaves a passing pair alone', () => {
		expect(suggestForeground('0 0% 100%', '0 0% 10%', 4.5)).toBe('0 0% 100%');
	});
});

describe('contrastIssues', () => {
	it('has no errors for a healthy palette', () => {
		const nord = { ...COVE_TOKENS.dark, ...getBuiltinTheme('nord')!.tokens };
		expect(contrastIssues(nord).filter((i) => i.level === 'error')).toEqual([]);
	});

	it('flags weak and unreadable pairs, with a fix for each', () => {
		const tokens = { ...COVE_TOKENS.dark, foreground: '0 0% 22%', 'card-foreground': '0 0% 17%' };
		const issues = contrastIssues(tokens);
		const fg = issues.find((i) => i.foreground === 'foreground' && i.surface === 'background')!;
		expect(fg.level).toBe('error');
		expect(contrastRatio(fg.fix!, tokens.background)).toBeGreaterThanOrEqual(MIN_CONTRAST_AA);
		const card = issues.find((i) => i.foreground === 'card-foreground')!;
		expect(card.ratio).toBeLessThan(MIN_CONTRAST_AA);
	});
});

describe('autoFixTokens', () => {
	it('repairs the text colours and never touches surfaces', () => {
		const tokens = {
			...COVE_TOKENS.dark,
			foreground: '0 0% 25%',
			'muted-foreground': '0 0% 22%',
			'accent-foreground': '0 0% 25%',
		};
		const fixed = autoFixTokens(tokens);
		expect(contrastIssues(fixed)).toEqual([]);
		expect(fixed.background).toBe(tokens.background);
		expect(fixed.card).toBe(tokens.card);
	});

	it('does not change a palette that already passes', () => {
		const tokens = { ...COVE_TOKENS.dark, ...getBuiltinTheme('nord')!.tokens };
		if (contrastIssues(tokens).length === 0) expect(autoFixTokens(tokens)).toEqual(tokens);
	});
});
