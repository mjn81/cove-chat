import type { SettingsTab } from '@/components/SettingsModal/types';

/** Settings tabs a link may open. Only admin is linked to today (the server's "update available" notice). */
const LINKABLE: readonly SettingsTab[] = ['admin'];

/**
 * Reads `?settings=<tab>` from the address. The server still checks the role on every request, so opening the admin
 * tab for a non-admin shows nothing.
 *
 * @param search - The query string to read (defaults to the current location).
 * @returns The tab to open, or null.
 */
export function readSettingsDeepLink(search: string = window.location.search): SettingsTab | null {
	const tab = new URLSearchParams(search).get('settings');
	return LINKABLE.find((t) => t === tab) ?? null;
}

/** Removes `settings` from the address bar so reloading or sharing the URL does not reopen the dialog. */
export function clearSettingsDeepLink(): void {
	const params = new URLSearchParams(window.location.search);
	if (!params.has('settings')) return;
	params.delete('settings');
	const rest = params.toString();
	window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
}
