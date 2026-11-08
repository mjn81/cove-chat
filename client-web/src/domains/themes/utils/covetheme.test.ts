import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	makeJpeg,
	makePng,
	makeWebpX,
	rawZip,
	textEntry,
	themeJsonEntry,
	validThemeJson,
} from './covetheme.fixtures';
import { COVETHEME_LIMITS, buildCoveTheme, parseCoveTheme } from './covetheme';

const enc = new TextEncoder();

function parse(entries: Parameters<typeof rawZip>[0]) {
	return parseCoveTheme(rawZip(entries));
}
function parseJson(json: unknown) {
	return parse([themeJsonEntry(json)]);
}
function errCode(r: ReturnType<typeof parseCoveTheme>): string | undefined {
	return r.ok ? undefined : r.error.code;
}
function errDetails(r: ReturnType<typeof parseCoveTheme>): string[] {
	return r.ok ? [] : r.errors.map((e) => `${e.code}:${e.detail ?? ''}`);
}

describe('parseCoveTheme: valid themes', () => {
	it('parses a minimal theme', () => {
		const r = parseJson(validThemeJson());
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.theme.id).toBe('test-theme');
		expect(r.theme.name).toEqual({ en: 'Test theme', fa: 'پوسته آزمایشی', ar: 'سمة تجريبية' });
		expect(r.theme.base).toBe('dark');
		expect(r.theme.tokens.primary).toBe('13 59% 63%');
		expect(r.assets).toEqual({});
	});

	it('accepts hex values and a light variant', () => {
		const json = validThemeJson();
		const light = {
			background: '#ffffff', foreground: '#111111', card: '#f4f4f4', 'card-foreground': '#111111',
			popover: '#ffffff', 'popover-foreground': '#111111', primary: '#b3401f', 'primary-foreground': '#ffffff',
			secondary: '#f4f4f4', 'secondary-foreground': '#111111', muted: '#f4f4f4', 'muted-foreground': '#555555',
			accent: '#eaeaea', 'accent-foreground': '#111111', destructive: '#b3261e', 'destructive-foreground': '#ffffff',
			border: '#dddddd', input: '#dddddd', ring: '#b3401f',
		};
		const r = parseJson({ ...json, light });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.theme.light?.background).toBe('0 0% 100%');
	});

	it('parses chat background kinds', () => {
		const ok = (background: unknown) => parseJson(validThemeJson({ chat: { background } }));
		const pattern = ok({ type: 'pattern', pattern: 'space' });
		expect(pattern.ok && pattern.theme.chat?.background).toEqual({ type: 'pattern', pattern: 'space' });
		const color = ok({ type: 'color', color: '#202020' });
		expect(color.ok && color.theme.chat?.background).toEqual({ type: 'color', color: '0 0% 12.5%' });
		const grad = ok({ type: 'gradient', from: '10 20% 15%', to: '#102030', angle: 400 });
		expect(grad.ok && grad.theme.chat?.background).toMatchObject({ type: 'gradient', angle: 360 });
		expect(ok({ type: 'none' }).ok).toBe(true);
	});

	it('keeps referenced images and the preview, drops unreferenced ones', () => {
		const r = parse([
			themeJsonEntry(
				validThemeJson({
					chat: { background: { type: 'image', asset: 'assets/bg.png', opacity: 2, blur: 99, fit: 'tile' } },
					preview: 'assets/preview.webp',
				}),
			),
			{ name: 'assets/bg.png', data: makePng(1200, 800) },
			{ name: 'assets/preview.webp', data: makeWebpX(320, 200) },
			{ name: 'assets/unused.jpg', data: makeJpeg(10, 10) },
		]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(Object.keys(r.assets).sort()).toEqual(['assets/bg.png', 'assets/preview.webp']);
		expect(r.theme.chat?.background).toEqual({ type: 'image', asset: 'assets/bg.png', opacity: 1, blur: 20, fit: 'tile' });
		expect(r.theme.preview).toBe('assets/preview.webp');
		expect(r.assets['assets/bg.png']).toMatchObject({ mime: 'image/png', width: 1200, height: 800 });
		expect(r.warnings.map((w) => w.code)).toContain('unused_asset');
	});

	it('round-trips through buildCoveTheme', () => {
		const first = parseJson(validThemeJson({ chat: { bubble_tint: { color: '#336699', strength: 0.2 } } }));
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const again = parseCoveTheme(buildCoveTheme(first.theme, first.assets));
		expect(again.ok).toBe(true);
		if (again.ok) expect(again.theme).toEqual(first.theme);
	});

	it('round-trips image assets', () => {
		const first = parse([
			themeJsonEntry(validThemeJson({ chat: { background: { type: 'image', asset: 'assets/bg.jpg' } } })),
			{ name: 'assets/bg.jpg', data: makeJpeg(100, 50) },
		]);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const again = parseCoveTheme(buildCoveTheme(first.theme, first.assets));
		expect(again.ok && Object.keys(again.assets)).toEqual(['assets/bg.jpg']);
	});
});

describe('parseCoveTheme: schema', () => {
	it.each([
		['not a cove theme', { format: 'other' }],
		['no format', { format: undefined }],
		['future version', { version: 2 }],
		['non-numeric version', { version: '1' }],
	])('rejects %s', (_n, patch) => {
		expect(parseJson({ ...validThemeJson(), ...patch }).ok).toBe(false);
	});

	it('reports unsupported versions distinctly', () => {
		expect(errCode(parseJson({ ...validThemeJson(), version: 2 }))).toBe('unsupported_version');
	});

	it.each(['', 'A', 'ab', 'Has Space', '../x', 'x'.repeat(65), 'UPPER', 'a/b', 'a..b', '-lead', 'trail-'])('rejects id %j', (id) => {
		expect(parseJson(validThemeJson({ id })).ok).toBe(false);
	});

	it('requires an English name and bounds every name', () => {
		expect(parseJson(validThemeJson({ name: { fa: 'x' } })).ok).toBe(false);
		expect(parseJson(validThemeJson({ name: 'plain string' })).ok).toBe(false);
		expect(parseJson(validThemeJson({ name: { en: 'x'.repeat(41) } })).ok).toBe(false);
		expect(parseJson(validThemeJson({ name: { en: '   ' } })).ok).toBe(false);
	});

	it('refuses control and bidi-override characters in text', () => {
		expect(parseJson(validThemeJson({ name: { en: 'Evil‮name' } })).ok).toBe(false);
		expect(parseJson(validThemeJson({ name: { en: 'bell\u0007' } })).ok).toBe(false);
	});

	it('drops an invalid optional name or author rather than failing', () => {
		const r = parseJson(validThemeJson({ name: { en: 'Ok', fa: 5 }, author: { x: 1 }, license: 'x'.repeat(100) }));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.theme.name).toEqual({ en: 'Ok' });
		expect(r.theme.author).toBeUndefined();
		expect(r.theme.license).toBeUndefined();
	});

	it('requires base to be dark or light', () => {
		expect(parseJson(validThemeJson({ base: 'sepia' })).ok).toBe(false);
		expect(parseJson(validThemeJson({ base: undefined })).ok).toBe(false);
	});

	it('drops unknown keys at every level and says so', () => {
		const json = validThemeJson({ script: 'alert(1)', css: 'body{}', chat: { evil: 1, background: { type: 'none', url: 'x' } } });
		const r = parseJson(json);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.theme).not.toHaveProperty('script');
		expect(r.theme).not.toHaveProperty('css');
		expect(r.warnings.filter((w) => w.code === 'unknown_key').length).toBeGreaterThanOrEqual(3);
	});

	it('is not fooled by prototype pollution keys', () => {
		const text = '{"format":"cove-theme","version":1,"id":"proto-test","name":{"en":"P"},"base":"dark","__proto__":{"polluted":true},"constructor":{"x":1},"tokens":' +
			JSON.stringify(validThemeJson().tokens) + '}';
		const r = parse([textEntry('theme.json', text)]);
		expect(r.ok).toBe(true);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('rejects non-JSON, non-object, and oversized theme.json', () => {
		expect(errCode(parse([textEntry('theme.json', '{nope')]))).toBe('invalid_json');
		expect(errCode(parse([textEntry('theme.json', '[1,2]')]))).toBe('invalid_json');
		expect(errCode(parse([textEntry('theme.json', 'null')]))).toBe('invalid_json');
		const big = JSON.stringify({ ...validThemeJson(), pad: 'x'.repeat(COVETHEME_LIMITS.maxJsonBytes) });
		expect(errCode(parse([textEntry('theme.json', big)]))).toBe('json_too_large');
	});

	it('requires theme.json', () => {
		expect(errCode(parse([{ name: 'assets/a.png', data: makePng(1, 1) }]))).toBe('missing_theme_json');
	});
});

describe('parseCoveTheme: tokens', () => {
	const tokens = (patch: Record<string, unknown>) => ({ ...(validThemeJson().tokens as object), ...patch });

	it('rejects CSS injection in values', () => {
		for (const v of ['red', 'url(https://evil/x)', '0 0% 0%; background: url(x)', 'var(--x)', 'expression(alert(1))', '0 0% 0% !important']) {
			expect(parseJson(validThemeJson({ tokens: tokens({ background: v }) })).ok).toBe(false);
		}
	});

	it('drops non-allow-listed token names and never exposes them', () => {
		const r = parseJson(validThemeJson({ tokens: tokens({ 'font-family': 'Comic Sans', radius: '0 0% 0%', '--primary': '0 0% 0%' }) }));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(Object.keys(r.theme.tokens).every((k) => !['font-family', 'radius', '--primary'].includes(k))).toBe(true);
		expect(r.warnings.filter((w) => w.code === 'unknown_token')).toHaveLength(3);
	});

	it('refuses a theme with unreadable text', () => {
		const r = parseJson(validThemeJson({ tokens: tokens({ foreground: '0 0% 11%' }) }));
		expect(errDetails(r)).toContain('low_contrast:foreground/background');
	});

	it('refuses an unreadable light variant too', () => {
		const light = { ...(validThemeJson().tokens as object) }; // dark colours used as "light": fine on their own
		const bad = { ...light, foreground: '0 0% 11%' };
		expect(parseJson(validThemeJson({ light: bad })).ok).toBe(false);
	});

	it('warns (does not refuse) for mediocre contrast', () => {
		const r = parseJson(validThemeJson({ tokens: tokens({ foreground: '0 0% 42%' }) }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.warnings.some((w) => w.code === 'low_contrast')).toBe(true);
	});

	it('refuses an unreadable chat background colour', () => {
		const r = parseJson(validThemeJson({ chat: { background: { type: 'color', color: '0 0% 90%' } } }));
		expect(errDetails(r)).toContain('low_contrast:chat-background');
	});

	it('ignores a light variant on a light base', () => {
		const r = parseJson(validThemeJson({ base: 'light', tokens: { ...(validThemeJson().tokens as object), background: '0 0% 100%', foreground: '0 0% 5%', card: '0 0% 96%', 'card-foreground': '0 0% 5%', popover: '0 0% 100%', 'popover-foreground': '0 0% 5%', primary: '12 51% 40%', 'primary-foreground': '0 0% 100%', secondary: '0 0% 96%', 'secondary-foreground': '0 0% 5%', muted: '0 0% 96%', 'muted-foreground': '0 0% 35%', accent: '0 0% 90%', 'accent-foreground': '0 0% 5%', destructive: '0 66% 40%', 'destructive-foreground': '0 0% 100%' }, light: {} }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.theme.light).toBeUndefined();
	});
});

describe('parseCoveTheme: assets', () => {
	const withAsset = (name: string, data: Uint8Array, bgAsset = name) =>
		parse([
			themeJsonEntry(validThemeJson({ chat: { background: { type: 'image', asset: bgAsset } } })),
			{ name, data },
		]);

	it('refuses SVG, GIF, HTML and script payloads disguised as images', () => {
		expect(errCode(withAsset('assets/bg.png', enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))).toBe('invalid_image');
		expect(errCode(withAsset('assets/bg.png', enc.encode('GIF89a\u0001\u0000\u0001\u0000')))).toBe('invalid_image');
		expect(errCode(withAsset('assets/bg.jpg', enc.encode('<html><script>alert(1)</script>')))).toBe('invalid_image');
	});

	it('refuses SVG and other extensions outright', () => {
		expect(errDetails(withAsset('assets/bg.svg', enc.encode('<svg/>')))).toContain('invalid_asset_name:assets/bg.svg');
		expect(errCode(withAsset('assets/bg.gif', makePng(10, 10)))).toBe('invalid_asset_name');
		expect(errCode(withAsset('assets/font.woff2', new Uint8Array(10)))).toBe('invalid_asset_name');
		expect(errCode(withAsset('assets/bg.css', enc.encode('body{}')))).toBe('invalid_asset_name');
	});

	it('refuses an image whose type does not match its extension', () => {
		expect(errCode(withAsset('assets/bg.png', makeJpeg(10, 10)))).toBe('image_type_mismatch');
	});

	it('refuses nested archives even when named like an image', () => {
		const inner = zipSync({ 'a.txt': enc.encode('x') });
		expect(errCode(withAsset('assets/bg.png', inner))).toBe('invalid_image');
	});

	it('refuses oversized dimensions and file sizes', () => {
		expect(errCode(withAsset('assets/bg.png', makePng(4097, 100)))).toBe('image_dimensions');
		expect(errCode(withAsset('assets/bg.png', makePng(100, 4097)))).toBe('image_dimensions');
		expect(withAsset('assets/bg.png', makePng(4096, 4096)).ok).toBe(true);
		expect(errCode(withAsset('assets/bg.png', makePng(10, 10, COVETHEME_LIMITS.maxImageBytes)))).toBe('image_too_large');
	});

	it('refuses when images add up to too much', () => {
		const each = Math.floor(COVETHEME_LIMITS.maxImageBytes * 0.9);
		const entries = [
			themeJsonEntry(validThemeJson()),
			...Array.from({ length: 5 }, (_, i) => ({ name: `assets/b${i}.png`, data: makePng(10, 10, each) })),
		];
		expect(errCode(parse(entries))).toBe('assets_too_large');
	});

	it('refuses a background that points at a missing, hostile or remote asset', () => {
		const bg = (asset: string) => parseJson(validThemeJson({ chat: { background: { type: 'image', asset } } }));
		for (const a of ['assets/missing.png', '../x.png', 'https://evil.example/x.png', 'data:image/png;base64,AAAA', 'theme.json', 'assets/../theme.json']) {
			expect(bg(a).ok).toBe(false);
		}
	});

	it('drops a missing preview with a warning instead of failing', () => {
		const r = parseJson(validThemeJson({ preview: 'assets/none.png' }));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.theme.preview).toBeUndefined();
			expect(r.warnings.map((w) => w.code)).toContain('missing_preview');
		}
	});

	it('does not read files outside theme.json and assets/, and warns', () => {
		const r = parse([themeJsonEntry(validThemeJson()), textEntry('readme.txt', 'hi'), textEntry('script.js', 'alert(1)')]);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.warnings.filter((w) => w.code === 'ignored_entry')).toHaveLength(2);
	});

	it('refuses nested directories under assets/', () => {
		expect(errCode(parse([themeJsonEntry(validThemeJson()), { name: 'assets/sub/bg.png', data: makePng(1, 1) }]))).toBe('invalid_asset_name');
	});
});

describe('parseCoveTheme: archive hardening applies', () => {
	it('rejects path traversal and symlinks', () => {
		expect(errCode(parse([themeJsonEntry(validThemeJson()), { name: '../evil.png', data: makePng(1, 1) }]))).toBe('zip_unsafe_path');
		expect(errCode(parse([themeJsonEntry(validThemeJson()), { name: 'assets/l.png', data: enc.encode('/etc/passwd'), os: 3, unixMode: 0o120777 }]))).toBe('zip_symlink');
	});

	it('rejects too many entries', () => {
		const entries = [themeJsonEntry(validThemeJson()), ...Array.from({ length: COVETHEME_LIMITS.maxEntries }, (_, i) => ({ name: `assets/${i}.png`, data: makePng(1, 1) }))];
		expect(errCode(parse(entries))).toBe('zip_too_many_entries');
	});

	it('never throws on garbage', () => {
		for (const junk of [new Uint8Array(0), enc.encode('PK'), new Uint8Array(1000).fill(255), enc.encode('{"format":"cove-theme"}')]) {
			expect(parseCoveTheme(junk).ok).toBe(false);
		}
	});
});
