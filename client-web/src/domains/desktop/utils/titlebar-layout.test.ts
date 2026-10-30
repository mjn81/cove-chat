import { describe, expect, it } from 'vitest';
import { MAC_LIGHTS_ZONE, titleBarLayout } from './titlebar-layout';

describe('titleBarLayout', () => {
	it('draws no bar inside the app shell on macOS: the traffic lights sit in the UI itself', () => {
		expect(titleBarLayout({ mac: true, inAppShell: true })).toEqual({
			visible: false,
			height: 0,
			blended: false,
			captionButtons: false,
			lightsInset: 0,
		});
	});

	it('uses a quiet bar that blends into the page on other macOS screens', () => {
		const layout = titleBarLayout({ mac: true, inAppShell: false });
		expect(layout.visible).toBe(true);
		expect(layout.blended).toBe(true);
		expect(layout.captionButtons).toBe(false);
		// Tall enough that the lights are not cramped against its edges, and clear of them horizontally.
		expect(layout.height).toBe(MAC_LIGHTS_ZONE);
		expect(layout.lightsInset).toBeGreaterThanOrEqual(78);
	});

	it('keeps the framed bar with caption buttons on Windows and Linux, in or out of the app shell', () => {
		for (const inAppShell of [true, false]) {
			expect(titleBarLayout({ mac: false, inAppShell })).toEqual({
				visible: true,
				height: 28,
				blended: false,
				captionButtons: true,
				lightsInset: 0,
			});
		}
	});

	it('gives the lights a zone at least as tall as the native title bar', () => {
		expect(MAC_LIGHTS_ZONE).toBeGreaterThanOrEqual(38);
	});
});
