import { describe, expect, it } from 'vitest';

import { ENTER_MS, EXIT_MS, cardMotion, nextLeaving, slotMotion } from './popup-motion';

describe('cardMotion', () => {
	it('slides in from the right edge of a right corner and from the left of a left corner', () => {
		expect(cardMotion('entering', 'bottom-right', false).transform).toBe('translateX(100%)');
		expect(cardMotion('entering', 'top-left', false).transform).toBe('translateX(-100%)');
		expect(cardMotion('shown', 'bottom-right', false)).toMatchObject({ opacity: 1, transform: 'translateX(0)' });
	});
	it('only fades with reduced motion', () => {
		const m = cardMotion('entering', 'bottom-right', true);
		expect(m.transform).toBe('translateX(0)');
		expect(m.opacity).toBe(0);
	});
	it('fades out quickly without sliding', () => {
		const m = cardMotion('leaving', 'bottom-right', false);
		expect(m.opacity).toBe(0);
		expect(m.transform).toBe('translateX(0)');
		expect(String(m.transition)).toContain(`opacity ${EXIT_MS}ms`);
		expect(EXIT_MS).toBeLessThanOrEqual(200);
		expect(ENTER_MS).toBeLessThanOrEqual(300);
	});
});

describe('slotMotion', () => {
	it('keeps the slot until leaving, then collapses height and gap', () => {
		expect(slotMotion('shown', 76, 4, false, false)).toMatchObject({ height: 76, marginTop: 4 });
		expect(slotMotion('shown', 76, 4, true, false)).toMatchObject({ height: 76, marginTop: 0 });
		expect(slotMotion('leaving', 76, 4, false, false)).toMatchObject({ height: 0, marginTop: 0 });
	});
});

describe('nextLeaving', () => {
	it('adds new ids, keeps old ones still on screen, forgets gone ones', () => {
		const next = nextLeaving(new Set(['a', 'gone']), ['b'], ['a', 'b', 'c']);
		expect([...next].sort()).toEqual(['a', 'b']);
	});
});
