/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'cyrillic-font.css'), 'utf8');
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)]
	.flatMap((m) => m[1].split(','))
	.map((r) => {
		const [a, b] = r.trim().replace('U+', '').split('-');
		return [parseInt(a, 16), parseInt(b ?? a, 16)] as const;
	});
const covers = (ch: string) => ranges.some(([a, b]) => ch.codePointAt(0)! >= a && ch.codePointAt(0)! <= b);

describe('bundled Cyrillic font', () => {
	it('adds faces to the Vazirmatn family, so every font stack that names it gets Cyrillic', () => {
		expect(faces.length).toBe(2);
		for (const face of faces) expect(face).toMatch(/font-family:\s*'Vazirmatn';/);
	});

	it('covers Russian, other Cyrillic letters and the numero sign', () => {
		for (const ch of ['А', 'я', 'Ё', 'ё', 'І', 'ї', 'Ґ', 'Ѣ', '№']) expect(covers(ch), ch).toBe(true);
	});

	it('leaves Latin, Arabic script and emoji to the other fonts', () => {
		for (const ch of ['a', '0', 'م', 'پ', '😀']) expect(covers(ch), ch).toBe(false);
	});

	it('is self-hosted from files that exist', () => {
		expect(urls.length).toBe(2);
		for (const url of urls) expect(existsSync(resolve(__dirname, url)), url).toBe(true);
		expect(css).not.toMatch(/https?:/);
	});

	it.each(['../main.tsx', '../popup.tsx'])('is loaded by %s', (entry) => {
		expect(readFileSync(resolve(__dirname, entry), 'utf8')).toMatch(/cyrillic-font\.css/);
	});
});
