import { describe, it, expect } from 'vitest';
import { DOCK_MIN_WIDTH_QUERY, emojiButtonTarget, isDockVisible } from './emoji-dock';

describe('emoji dock rules', () => {
	it('shows only in dock mode, open, on wide windows', () => {
		expect(isDockVisible('dock', true, true)).toBe(true);
		expect(isDockVisible('dock', false, true)).toBe(false);
		expect(isDockVisible('popover', true, true)).toBe(false);
		expect(isDockVisible('dock', true, false)).toBe(false);
	});
	it('the emoji button targets the dock only when docking is possible', () => {
		expect(emojiButtonTarget('dock', true)).toBe('dock');
		expect(emojiButtonTarget('dock', false)).toBe('popover');
		expect(emojiButtonTarget('popover', true)).toBe('popover');
	});
	it('uses a min-width media query', () => {
		expect(DOCK_MIN_WIDTH_QUERY).toBe('(min-width: 1100px)');
	});
});
