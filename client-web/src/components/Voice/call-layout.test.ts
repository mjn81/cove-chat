import { describe, expect, it } from 'vitest';
import { DEFAULT_SCREEN_SHARE_SETTINGS } from '@/store/voiceStore';
import { chunkRows, fitGrid, matchStreamPreset, pickTileRatio } from './call-layout';

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

describe('pickTileRatio', () => {
	it('uses landscape tiles for wide areas and portrait tiles for tall ones', () => {
		expect(pickTileRatio(1200, 500)).toBeCloseTo(16 / 9);
		expect(pickTileRatio(360, 640)).toBeLessThan(1);
	});
});

describe('fitGrid in portrait areas', () => {
	it('gives phone-sized stages more tile area with a portrait ratio and still fits', () => {
		const wide = fitGrid(4, 360, 600, 8);
		const tall = fitGrid(4, 360, 600, 8, pickTileRatio(360, 600));
		expect(tall.width * tall.height).toBeGreaterThan(wide.width * wide.height);
		expect(tall.cols * tall.width + (tall.cols - 1) * 8).toBeLessThanOrEqual(360);
		expect(tall.rows * tall.height + (tall.rows - 1) * 8).toBeLessThanOrEqual(600);
	});
});

describe('chunkRows', () => {
	it('splits items into rows of at most `cols`', () => {
		expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunkRows([1, 2], 0)).toEqual([]);
	});
});
