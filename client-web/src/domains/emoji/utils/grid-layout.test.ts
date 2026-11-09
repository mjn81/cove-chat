import { describe, it, expect } from 'vitest';
import { columnsFor, gridHeight, pickerColumns, stickerColumns } from './grid-layout';

describe('columnsFor', () => {
	it('fits whole cells and never returns less than one', () => {
		expect(columnsFor(320, 36)).toBe(8);
		expect(columnsFor(35, 36)).toBe(1);
		expect(columnsFor(0, 36)).toBe(1);
	});
});

describe('gridHeight', () => {
	it('rounds the last row up', () => {
		expect(gridHeight(16, 8, 36)).toBe(72);
		expect(gridHeight(17, 8, 36)).toBe(108);
		expect(gridHeight(0, 8, 36)).toBe(0);
	});
	it('survives a zero column count', () => {
		expect(gridHeight(3, 0, 10)).toBe(30);
	});
});

describe('pickerColumns / stickerColumns', () => {
	it('adapts the emoji grid to the measured width', () => {
		expect(pickerColumns(0)).toBe(9);
		expect(pickerColumns(120)).toBe(5);
		expect(pickerColumns(340)).toBe(8);
		expect(pickerColumns(380)).toBe(9);
		expect(pickerColumns(900)).toBe(12);
	});
	it('gives sticker grids 3 to 6 equal columns', () => {
		expect(stickerColumns(0)).toBe(4);
		expect(stickerColumns(200)).toBe(3);
		expect(stickerColumns(340)).toBe(4);
		expect(stickerColumns(1000)).toBe(6);
	});
});
