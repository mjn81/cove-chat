import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	hexToHslTriplet,
	hslToTriplet,
	tripletToHex,
	tripletToHsl,
	hslTripletToRgb,
	mixHex,
	parseColorValue,
	pickForeground,
	relativeLuminance,
} from './color';

describe('parseColorValue', () => {
	it('accepts an HSL triplet and normalises it', () => {
		expect(parseColorValue('13 59% 63%')).toEqual({ value: '13 59% 63%', clamped: false });
		expect(parseColorValue('  210.5   40%  20.25% ')?.value).toBe('210.5 40% 20.3%');
	});

	it('clamps out-of-range components and reports it', () => {
		expect(parseColorValue('400 120% 150%')).toEqual({ value: '360 100% 100%', clamped: true });
	});

	it('converts strict hex (#rgb and #rrggbb) to a triplet', () => {
		expect(parseColorValue('#ffffff')?.value).toBe('0 0% 100%');
		expect(parseColorValue('#000')?.value).toBe('0 0% 0%');
		expect(parseColorValue('#D9826A')?.value).toBe('13 59.4% 63.3%');
	});

	it.each([
		'',
		'red',
		'rgb(1,2,3)',
		'hsl(1 2% 3%)',
		'#12345',
		'#12345678',
		'#gggggg',
		'13 59 63',
		'13 59% 63% / 0.5',
		'-5 10% 10%',
		'1e3 10% 10%',
		'13 59% 63%; color: red',
		'url(javascript:alert(1))',
		'var(--primary)',
	])('rejects %j', (v) => {
		expect(parseColorValue(v)).toBeNull();
	});

	it('rejects non-strings', () => {
		expect(parseColorValue(42)).toBeNull();
		expect(parseColorValue(null)).toBeNull();
		expect(parseColorValue({})).toBeNull();
	});
});

describe('contrast', () => {
	it('computes WCAG luminance and ratios', () => {
		expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
		expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
		expect(contrastRatio('0 0% 100%', '0 0% 0%')).toBeCloseTo(21, 1);
		expect(contrastRatio('0 0% 50%', '0 0% 50%')).toBeCloseTo(1, 5);
	});

	it('is symmetric', () => {
		expect(contrastRatio('20 6% 13%', '25 10% 90%')).toBeCloseTo(contrastRatio('25 10% 90%', '20 6% 13%'), 8);
	});

	it('converts HSL to RGB', () => {
		expect(hslTripletToRgb('0 100% 50%')).toEqual([255, 0, 0]);
		expect(hslTripletToRgb('0 0% 100%')).toEqual([255, 255, 255]);
	});
});

describe('helpers', () => {
	it('mixes hex colours', () => {
		expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
		expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
	});

	it('hexToHslTriplet throws on junk (authoring bug)', () => {
		expect(() => hexToHslTriplet('nope')).toThrow();
	});

	it('picks the readable foreground for a background', () => {
		expect(pickForeground('0 0% 100%')).toBe('0 0% 4%');
		expect(pickForeground('0 0% 0%')).toBe('0 0% 100%');
		for (const bg of ['13 59% 63%', '231 82% 66%', '0 100% 50%', '200 80% 40%']) {
			const fg = pickForeground(bg);
			expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe('slider helpers', () => {
	it('round-trips a triplet through numbers', () => {
		expect(tripletToHsl('217 91% 60%')).toEqual([217, 91, 60]);
		expect(hslToTriplet(217, 91, 60)).toBe('217 91% 60%');
	});
	it('clamps and rounds slider output', () => {
		expect(hslToTriplet(400, 120, -5)).toBe('360 100% 0%');
		expect(hslToTriplet(10.04, 20, 30)).toBe('10 20% 30%');
	});
	it('gives hex for display', () => {
		expect(tripletToHex('0 100% 50%')).toBe('#ff0000');
		expect(tripletToHex('0 0% 100%')).toBe('#ffffff');
	});
	it('does not throw on text outside the grammar', () => {
		expect(tripletToHsl('nope')).toEqual([0, 0, 0]);
	});
});
