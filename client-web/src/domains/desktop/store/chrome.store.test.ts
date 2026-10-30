import { beforeEach, describe, expect, it } from 'vitest';
import { useDesktopChromeStore } from './chrome.store';

describe('desktop chrome store', () => {
	beforeEach(() => useDesktopChromeStore.setState({ inAppShell: false }));

	it('starts outside the app shell', () => {
		expect(useDesktopChromeStore.getState().inAppShell).toBe(false);
	});

	it('tracks entering and leaving the app shell', () => {
		useDesktopChromeStore.getState().setInAppShell(true);
		expect(useDesktopChromeStore.getState().inAppShell).toBe(true);
		useDesktopChromeStore.getState().setInAppShell(false);
		expect(useDesktopChromeStore.getState().inAppShell).toBe(false);
	});
});
