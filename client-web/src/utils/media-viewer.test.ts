import { describe, expect, it } from 'vitest';

import { resolveArrowKey } from './media-viewer';

describe('resolveArrowKey', () => {
	it('maps ArrowLeft to previous and ArrowRight to next in LTR', () => {
		expect(resolveArrowKey('ArrowLeft', 'ltr')).toBe('prev');
		expect(resolveArrowKey('ArrowRight', 'ltr')).toBe('next');
	});

	it('mirrors the arrows in RTL so the key points the way the UI flows', () => {
		expect(resolveArrowKey('ArrowLeft', 'rtl')).toBe('next');
		expect(resolveArrowKey('ArrowRight', 'rtl')).toBe('prev');
	});

	it('ignores every other key', () => {
		expect(resolveArrowKey('Enter', 'ltr')).toBeNull();
		expect(resolveArrowKey('ArrowUp', 'rtl')).toBeNull();
	});
});
