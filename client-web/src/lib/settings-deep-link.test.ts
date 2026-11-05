import { describe, expect, it } from 'vitest';

import { clearSettingsDeepLink, readSettingsDeepLink } from './settings-deep-link';

describe('readSettingsDeepLink', () => {
	it('accepts the admin tab', () => {
		expect(readSettingsDeepLink('?settings=admin')).toBe('admin');
	});

	it('ignores unknown tabs and missing parameters', () => {
		expect(readSettingsDeepLink('?settings=voice')).toBeNull();
		expect(readSettingsDeepLink('?settings=<script>')).toBeNull();
		expect(readSettingsDeepLink('')).toBeNull();
	});
});

describe('clearSettingsDeepLink', () => {
	it('removes only the settings parameter from the address bar', () => {
		window.history.replaceState(null, '', '/?settings=admin&x=1');
		clearSettingsDeepLink();
		expect(window.location.search).toBe('?x=1');
	});
});
