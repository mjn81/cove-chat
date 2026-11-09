import { describe, it, expect } from 'vitest';
import { placePanel } from './panel-placement';

const vp = { width: 1200, height: 800 };
const panel = { width: 380, height: 440 };
const btn = (left: number, top: number) => ({ left, right: left + 32, top, bottom: top + 32 });

describe('placePanel', () => {
	it('sits above the button, aligned to its end edge', () => {
		const p = placePanel(btn(1100, 740), vp, panel);
		expect(p).toMatchObject({ width: 380, height: 440, left: 1132 - 380, top: 740 - 8 - 440 });
	});

	it('flips below when there is no room above', () => {
		const p = placePanel(btn(600, 20), vp, panel);
		expect(p.top).toBe(20 + 32 + 8);
	});

	it('stays inside the window horizontally', () => {
		expect(placePanel(btn(1180, 700), vp, panel).left + 380).toBeLessThanOrEqual(1200 - 8);
		expect(placePanel(btn(0, 700), vp, panel).left).toBeGreaterThanOrEqual(8);
	});

	it('shrinks in a small window instead of overflowing', () => {
		const p = placePanel(btn(300, 560), { width: 360, height: 600 }, panel);
		expect(p.width).toBe(344);
		expect(p.height).toBeLessThanOrEqual(560 - 16);
		expect(p.top).toBeGreaterThanOrEqual(8);
	});

	it('aligns to the start edge in right-to-left layouts', () => {
		expect(placePanel(btn(100, 700), vp, panel, true).left).toBe(100);
	});
});
