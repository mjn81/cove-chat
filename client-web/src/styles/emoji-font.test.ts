import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'emoji-font.css'), 'utf8');
const tailwind = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf8');

/** Parses `U+XXXX` and `U+XXXX-YYYY` items of a unicode-range into [from, to] pairs. */
const ranges = (() => {
	const m = /unicode-range:\s*([^;]+);/.exec(css);
	return (m?.[1] ?? '').split(',').map((r) => {
		const [a, b] = r.trim().replace('U+', '').split('-');
		return [parseInt(a, 16), parseInt(b ?? a, 16)] as const;
	});
})();
const covers = (cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);

describe('bundled emoji font', () => {
	it('covers emoji, joiners and variation selectors', () => {
		for (const cp of [0x1f600, 0x1faa0, 0x2764, 0x200d, 0xfe0f, 0x20e3, 0x1f1e9, 0xe0067]) expect(covers(cp), cp.toString(16)).toBe(true);
	});

	it('does not claim ordinary text (digits, #, *, letters, copyright signs), which would turn text into colour emoji', () => {
		for (const ch of ['0', '9', '#', '*', 'a', 'م', '©', '®', ' ']) expect(covers(ch.codePointAt(0)!), ch).toBe(false);
	});

	it('is a bundled woff2 and not a remote URL', () => {
		expect(css).toMatch(/url\('\.\.\/\.\.\/node_modules\/@fontsource\/noto-color-emoji\/files\/[^']+\.woff2'\)/);
		expect(css).not.toMatch(/https?:/);
	});

	it('goes ahead of every system font in the app font stack, so the OS emoji font is never chosen', () => {
		const stack = /sans:\s*\[([^\]]+)\]/.exec(tailwind)![1].split(',').map((s) => s.trim().replace(/"/g, ''));
		expect(stack.indexOf('var(--emoji-font)')).toBe(stack.indexOf('Vazirmatn') + 1);
		expect(stack.indexOf('var(--emoji-font)')).toBeLessThan(stack.indexOf('system-ui'));
		expect(stack.indexOf('var(--emoji-font)')).toBeLessThan(stack.indexOf('Segoe UI'));
	});

	it("defaults to Noto and uses the OS fonts only for the 'device' style", () => {
		expect(css).toMatch(/:root\s*\{\s*--emoji-font:\s*'Noto Color Emoji';/);
		expect(css).toMatch(/:root\[data-emoji='device'\]\s*\{\s*--emoji-font:[^;]*Segoe UI Emoji/);
	});
});
