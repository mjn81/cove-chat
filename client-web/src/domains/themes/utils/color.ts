/**
 * Colour parsing and WCAG maths for themes. Everything here is pure.
 *
 * Theme colours are stored in the same form the CSS variables use (`H S% L%`, see `index.css`), so a value can be
 * handed to `style.setProperty` as-is. The grammar is deliberately tiny: nothing but a canonical HSL triplet ever
 * reaches the DOM, which is what makes theme data safe to apply.
 */

/** An RGB colour, 0-255 per channel. */
export type Rgb = [number, number, number];

const NUM = String.raw`(\d{1,3}(?:\.\d{1,2})?)`;
const TRIPLET_RE = new RegExp(String.raw`^${NUM}\s+${NUM}%\s+${NUM}%$`);
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
/** Rounds to one decimal and drops a trailing `.0`, so `13.0` and `13` produce the same canonical text. */
const fmt = (n: number) => String(Math.round(n * 10) / 10);

function rgbToHsl([r8, g8, b8]: Rgb): [number, number, number] {
	const r = r8 / 255;
	const g = g8 / 255;
	const b = b8 / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l * 100];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [h * 60, s * 100, l * 100];
}

/** Result of {@link parseColorValue}: the canonical triplet and whether any component had to be clamped. */
export interface ParsedColor {
	value: string;
	clamped: boolean;
}

function hexToRgb(hex: string): Rgb {
	let h = hex.slice(1);
	if (h.length === 3) h = [...h].map((c) => c + c).join('');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Parses a theme colour: either an `H S% L%` triplet (decimals allowed, ranges clamped) or a strict hex colour
 * (`#rgb` / `#rrggbb`, no alpha).
 *
 * @param input Untrusted value from a theme file.
 * @returns The canonical triplet, or `null` when the input is not in the grammar (including every non-string).
 */
export function parseColorValue(input: unknown): ParsedColor | null {
	if (typeof input !== 'string') return null;
	const text = input.trim();
	if (HEX_RE.test(text)) {
		const [h, s, l] = rgbToHsl(hexToRgb(text));
		return { value: `${fmt(h)} ${fmt(s)}% ${fmt(l)}%`, clamped: false };
	}
	const m = TRIPLET_RE.exec(text);
	if (!m) return null;
	const raw = [Number(m[1]), Number(m[2]), Number(m[3])];
	const h = clamp(raw[0], 0, 360);
	const s = clamp(raw[1], 0, 100);
	const l = clamp(raw[2], 0, 100);
	const clamped = h !== raw[0] || s !== raw[1] || l !== raw[2];
	return { value: `${fmt(h)} ${fmt(s)}% ${fmt(l)}%`, clamped };
}

const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

/**
 * Converts a hex literal to a canonical HSL triplet. For authoring built-in palettes only.
 *
 * @throws Error when `hex` is not `#rgb` / `#rrggbb`.
 */
export function hexToHslTriplet(hex: string): string {
	if (!HEX_RE.test(hex)) throw new Error(`invalid hex colour: ${hex}`);
	return (parseColorValue(hex) as ParsedColor).value;
}

/** Linear blend of two hex colours; `t` = 0 gives `a`, 1 gives `b`. Returns `#rrggbb`. */
export function mixHex(a: string, b: string, t: number): string {
	const ca = hexToRgb(a);
	const cb = hexToRgb(b);
	return '#' + [0, 1, 2].map((i) => toHex(ca[i] + (cb[i] - ca[i]) * t)).join('');
}

/** Converts a canonical `H S% L%` triplet to RGB. */
export function hslTripletToRgb(triplet: string): Rgb {
	const m = TRIPLET_RE.exec(triplet.trim());
	if (!m) throw new Error(`invalid HSL triplet: ${triplet}`);
	const h = Number(m[1]) % 360;
	const s = Number(m[2]) / 100;
	const l = Number(m[3]) / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb): number {
	const lin = (c: number) => {
		const v = c / 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1 to 21) between two canonical HSL triplets. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(hslTripletToRgb(a));
	const lb = relativeLuminance(hslTripletToRgb(b));
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const NEAR_BLACK = '0 0% 4%';
const WHITE = '0 0% 100%';

/** Chooses white or near-black text, whichever reads better on `background` (a triplet). */
export function pickForeground(background: string): string {
	return contrastRatio(WHITE, background) >= contrastRatio(NEAR_BLACK, background) ? WHITE : NEAR_BLACK;
}
