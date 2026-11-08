import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_THEMES, COVE_TOKENS, getBuiltinTheme } from '../data/builtin-themes';
import { THEME_TOKEN_NAMES } from './tokens';
import { createThemeEngine } from './theme-engine';

const nord = getBuiltinTheme('nord')!;
const cove = getBuiltinTheme('cove')!;
const dracula = getBuiltinTheme('dracula')!;

let root: HTMLElement;
beforeEach(() => {
	root = document.createElement('html');
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const prop = (name: string) => root.style.getPropertyValue(`--${name}`);

describe('apply', () => {
	it('sets every token as an inline custom property and the mode class', () => {
		const engine = createThemeEngine(root);
		const r = engine.apply(nord, 'dark');
		expect(r.mode).toBe('dark');
		expect(root.classList.contains('dark')).toBe(true);
		expect(root.classList.contains('light')).toBe(false);
		for (const name of THEME_TOKEN_NAMES) expect(prop(name)).toBe(nord.tokens[name]);
	});

	it('uses the light variant in light mode', () => {
		const engine = createThemeEngine(root);
		engine.apply(nord, 'light');
		expect(root.classList.contains('light')).toBe(true);
		expect(prop('background')).toBe(nord.light!.background);
	});

	it('keeps the class in step with the effective mode of single-variant themes', () => {
		const engine = createThemeEngine(root);
		expect(engine.apply(dracula, 'light').mode).toBe('dark');
		expect(root.classList.contains('dark')).toBe(true);
	});

	it('leaves the stylesheet in charge for Cove (no inline overrides)', () => {
		const engine = createThemeEngine(root);
		engine.apply(nord, 'dark');
		engine.apply(cove, 'dark');
		expect(root.style.length).toBe(0);
		expect(root.classList.contains('dark')).toBe(true);
	});

	it('switching theme replaces, not accumulates, tokens', () => {
		const engine = createThemeEngine(root);
		engine.apply(nord, 'dark');
		engine.apply(getBuiltinTheme('dracula')!, 'dark');
		expect(prop('primary')).toBe(getBuiltinTheme('dracula')!.tokens.primary);
	});

	it('only ever writes allow-listed, grammar-valid values', () => {
		const engine = createThemeEngine(root);
		const hostile = {
			id: 'hostile-one',
			name: { en: 'x' },
			base: 'dark' as const,
			tokens: {
				...COVE_TOKENS.dark,
				primary: 'red; background: url(//evil)',
				'font-family': 'Comic Sans',
				radius: '0px',
			} as never,
		};
		engine.apply(hostile, 'dark');
		expect(prop('primary')).toBe(COVE_TOKENS.dark.primary); // invalid value ignored, Cove fallback used
		expect(root.style.getPropertyValue('--font-family')).toBe('');
		expect(root.style.getPropertyValue('--radius')).toBe('');
		expect(root.style.cssText).not.toContain('evil');
	});

	it('records the theme id for debugging and CSS hooks', () => {
		const engine = createThemeEngine(root);
		engine.apply(nord, 'dark');
		expect(root.dataset.coveTheme).toBe('nord');
	});
});

describe('preview', () => {
	it('shows the previewed theme and reverts to the applied one', () => {
		const engine = createThemeEngine(root);
		engine.apply(nord, 'dark');
		const handle = engine.preview(getBuiltinTheme('gruvbox')!, 'dark');
		expect(engine.isPreviewing()).toBe(true);
		expect(prop('primary')).toBe(getBuiltinTheme('gruvbox')!.tokens.primary);
		handle.revert();
		expect(engine.isPreviewing()).toBe(false);
		expect(prop('primary')).toBe(nord.tokens.primary);
	});

	it('reverts to Cove cleanly when nothing custom was applied', () => {
		const engine = createThemeEngine(root);
		engine.apply(cove, 'dark');
		engine.preview(nord, 'dark').revert();
		expect(root.style.length).toBe(0);
	});

	it('auto-reverts after the timeout', () => {
		const engine = createThemeEngine(root);
		engine.apply(cove, 'dark');
		engine.preview(nord, 'dark', { timeoutMs: 60_000 });
		vi.advanceTimersByTime(59_999);
		expect(engine.isPreviewing()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(engine.isPreviewing()).toBe(false);
		expect(root.style.length).toBe(0);
	});

	it('does not let an apply during a preview clobber it, and applies once the preview ends', () => {
		const engine = createThemeEngine(root);
		engine.apply(cove, 'dark');
		const handle = engine.preview(nord, 'dark');
		engine.apply(getBuiltinTheme('gruvbox')!, 'dark');
		expect(prop('primary')).toBe(nord.tokens.primary);
		handle.revert();
		expect(prop('primary')).toBe(getBuiltinTheme('gruvbox')!.tokens.primary);
	});

	it('a second preview replaces the first; reverting a stale handle does nothing', () => {
		const engine = createThemeEngine(root);
		engine.apply(cove, 'dark');
		const first = engine.preview(nord, 'dark');
		const second = engine.preview(getBuiltinTheme('gruvbox')!, 'dark');
		first.revert();
		expect(engine.isPreviewing()).toBe(true);
		second.revert();
		expect(engine.isPreviewing()).toBe(false);
	});

	it('notifies subscribers about preview start and end', () => {
		const engine = createThemeEngine(root);
		const seen: boolean[] = [];
		const off = engine.subscribe(() => seen.push(engine.isPreviewing()));
		const h = engine.preview(nord, 'dark');
		h.revert();
		off();
		engine.preview(nord, 'dark');
		expect(seen).toEqual([true, false]);
	});
});

describe('BUILTIN_THEMES apply without leaving stray properties', () => {
	it.each(BUILTIN_THEMES.map((t) => [t.id, t] as const))('%s', (_id, t) => {
		const engine = createThemeEngine(root);
		engine.apply(t, 'dark');
		engine.apply(t, 'light');
		for (let i = 0; i < root.style.length; i++) {
			expect(root.style[i]).toMatch(/^--(?:[a-z-]+)$/);
			expect(THEME_TOKEN_NAMES).toContain(root.style[i].slice(2));
		}
	});
});
