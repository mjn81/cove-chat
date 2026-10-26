import { describe, expect, it } from 'vitest';
import { DEFAULT_SCREEN_SHARE_SETTINGS } from '@/store/voiceStore';
import { fitGrid, matchStreamPreset } from './call-layout';

describe('fitGrid', () => {
	it('returns zeros when there is nothing to lay out', () => {
		expect(fitGrid(0, 800, 600)).toEqual({ cols: 0, rows: 0, width: 0, height: 0 });
		expect(fitGrid(3, 0, 600)).toEqual({ cols: 0, rows: 0, width: 0, height: 0 });
	});

	it('keeps every tile at 16:9 without stretching', () => {
		for (const n of [1, 2, 3, 4, 5, 7, 9]) {
			const g = fitGrid(n, 900, 500, 12);
			expect(g.width / g.height).toBeCloseTo(16 / 9, 1);
		}
	});

	it('never overflows the container', () => {
		for (const n of [1, 2, 3, 6, 8]) {
			const g = fitGrid(n, 700, 420, 12);
			expect(g.cols * g.width + (g.cols - 1) * 12).toBeLessThanOrEqual(700);
			expect(g.rows * g.height + (g.rows - 1) * 12).toBeLessThanOrEqual(420);
		}
	});

	it('uses one row for two people in a wide box and stacks them in a tall one', () => {
		expect(fitGrid(2, 1000, 400).cols).toBe(2);
		expect(fitGrid(2, 400, 900).cols).toBe(1);
	});

	it('caps a single tile so a 1:1 call is not enormous', () => {
		expect(fitGrid(1, 3000, 2000).width).toBeLessThanOrEqual(960);
	});
});

describe('matchStreamPreset', () => {
	it('recognises the default settings as balanced', () => {
		expect(matchStreamPreset(DEFAULT_SCREEN_SHARE_SETTINGS)).toBe('balanced');
	});

	it('returns null for customised settings', () => {
		expect(matchStreamPreset({ ...DEFAULT_SCREEN_SHARE_SETTINGS, frameRate: 15 })).toBeNull();
	});
});
