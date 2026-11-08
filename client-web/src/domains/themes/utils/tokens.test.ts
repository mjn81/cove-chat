import { describe, expect, it } from 'vitest';
import {
	CORE_TOKEN_NAMES,
	THEME_TOKEN_NAMES,
	checkReadability,
	completeTokens,
	isThemeTokenName,
	sanitizeTokens,
	tokensToCssVars,
} from './tokens';

const GOOD = {
	background: '0 0% 10%',
	foreground: '0 0% 95%',
	card: '0 0% 14%',
	'card-foreground': '0 0% 95%',
	popover: '0 0% 8%',
	'popover-foreground': '0 0% 95%',
	primary: '13 59% 63%',
	'primary-foreground': '0 0% 5%',
	secondary: '0 0% 14%',
	'secondary-foreground': '0 0% 95%',
	muted: '0 0% 14%',
	'muted-foreground': '0 0% 70%',
	accent: '0 0% 20%',
	'accent-foreground': '0 0% 95%',
	destructive: '355 83% 66%',
	'destructive-foreground': '0 0% 5%',
	border: '0 0% 25%',
	input: '0 0% 25%',
	ring: '13 59% 63%',
};

describe('token allow-list', () => {
	it('knows the tokens index.css defines', () => {
		expect(THEME_TOKEN_NAMES).toContain('background');
		expect(THEME_TOKEN_NAMES).toContain('mention-border');
		expect(isThemeTokenName('primary')).toBe(true);
	});

	it.each(['radius', 'font-family', '--primary', 'primary;color', '__proto__', 'constructor', 'titlebar-h', ''])(
		'does not allow %j',
		(name) => {
			expect(isThemeTokenName(name)).toBe(false);
		},
	);

	it('requires the core set', () => {
		expect(CORE_TOKEN_NAMES.every((n) => n in GOOD)).toBe(true);
	});
});

describe('sanitizeTokens', () => {
	it('keeps valid tokens, normalising values', () => {
		const r = sanitizeTokens({ ...GOOD, background: '#1a1a1a' });
		expect(r.tokens.background).toBe('0 0% 10.2%');
		expect(r.errors).toEqual([]);
	});

	it('drops unknown token names with a warning (never applied)', () => {
		const r = sanitizeTokens({ ...GOOD, 'font-size': '20px', radius: '0 0% 0%', __proto__: { x: 1 } });
		expect(Object.keys(r.tokens).sort()).toEqual(Object.keys(GOOD).sort());
		expect(r.warnings.map((w) => w.code)).toContain('unknown_token');
	});

	it('reports invalid values as errors', () => {
		const r = sanitizeTokens({ ...GOOD, primary: 'url(x)' });
		expect(r.errors).toEqual([{ code: 'invalid_token_value', detail: 'primary' }]);
		expect(r.tokens.primary).toBeUndefined();
	});

	it('warns when clamping', () => {
		const r = sanitizeTokens({ ...GOOD, primary: '999 50% 50%' });
		expect(r.tokens.primary).toBe('360 50% 50%');
		expect(r.warnings).toContainEqual({ code: 'token_clamped', detail: 'primary' });
	});

	it('reports missing core tokens', () => {
		const { background: _b, ...rest } = GOOD;
		void _b;
		const r = sanitizeTokens(rest);
		expect(r.errors).toContainEqual({ code: 'missing_token', detail: 'background' });
	});

	it('rejects non-objects', () => {
		expect(sanitizeTokens('nope').errors).toEqual([{ code: 'invalid_tokens' }]);
		expect(sanitizeTokens(null).errors).toEqual([{ code: 'invalid_tokens' }]);
		expect(sanitizeTokens([1]).errors).toEqual([{ code: 'invalid_tokens' }]);
	});
});

describe('checkReadability', () => {
	it('passes a readable set without warnings', () => {
		expect(checkReadability(GOOD)).toEqual({ errors: [], warnings: [] });
	});

	it('refuses text that is unreadable on the background', () => {
		const r = checkReadability({ ...GOOD, foreground: '0 0% 12%' });
		expect(r.errors[0]).toMatchObject({ code: 'low_contrast', detail: 'foreground/background' });
	});

	it('refuses an invisible primary button label', () => {
		const r = checkReadability({ ...GOOD, 'primary-foreground': '13 59% 63%' });
		expect(r.errors.some((e) => e.detail === 'primary-foreground/primary')).toBe(true);
	});

	it('only warns between the hard limit and AA', () => {
		// About 3.3:1: readable enough to allow, worse than AA.
		const r = checkReadability({ ...GOOD, foreground: '0 0% 42%' });
		expect(r.errors).toEqual([]);
		expect(r.warnings.some((w) => w.code === 'low_contrast')).toBe(true);
	});
});

describe('completeTokens', () => {
	it('fills optional tokens from the fallback', () => {
		const fallback = { ...GOOD, 'mention-background': '1 1% 1%' } as never;
		const out = completeTokens(GOOD, fallback);
		expect(out['mention-background']).toBe('1 1% 1%');
		expect(out.primary).toBe(GOOD.primary);
	});
});

describe('tokensToCssVars', () => {
	it('prefixes names with --', () => {
		expect(tokensToCssVars({ primary: '1 2% 3%' })).toEqual({ '--primary': '1 2% 3%' });
	});
});
