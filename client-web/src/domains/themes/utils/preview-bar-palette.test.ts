import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color';
import { PREVIEW_BAR_VARS } from './preview-bar-palette';

const v = (name: string) => PREVIEW_BAR_VARS[`--${name}`];

describe('PREVIEW_BAR_VARS', () => {
	it('defines every colour the bar uses', () => {
		for (const name of ['card', 'card-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'border']) {
			expect(v(name), name).toBeTruthy();
		}
	});

	it('keeps text readable on the bar and on its buttons', () => {
		expect(contrastRatio(v('card-foreground'), v('card'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(v('primary-foreground'), v('primary'))).toBeGreaterThanOrEqual(4);
		expect(contrastRatio(v('secondary-foreground'), v('secondary'))).toBeGreaterThanOrEqual(4.5);
	});
});
