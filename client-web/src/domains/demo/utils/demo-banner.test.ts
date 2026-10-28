import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissDemoBanner, isDemoBannerDismissed } from './demo-banner';

afterEach(() => {
	sessionStorage.clear();
	vi.restoreAllMocks();
});

describe('demo banner dismissal', () => {
	it('is visible until dismissed, then stays dismissed for the session', () => {
		expect(isDemoBannerDismissed()).toBe(false);
		dismissDemoBanner();
		expect(isDemoBannerDismissed()).toBe(true);
	});

	it('does not throw when storage is unavailable', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(isDemoBannerDismissed()).toBe(false);
		expect(() => dismissDemoBanner()).not.toThrow();
	});
});
