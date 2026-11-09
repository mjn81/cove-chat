import { describe, it, expect } from 'vitest';
import { columnsFor, gridHeight } from './grid-layout';

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
