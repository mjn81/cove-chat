const KEY = 'cove_demo_banner_dismissed';

/**
 * Whether the user already closed the demo banner in this browser session. Storage can throw (private mode,
 * blocked site data), in which case the banner simply shows again.
 */
export function isDemoBannerDismissed(): boolean {
	try {
		return sessionStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

/** Remembers that the demo banner was closed until the tab or window is closed. */
export function dismissDemoBanner(): void {
	try {
		sessionStorage.setItem(KEY, '1');
	} catch {
		/* storage unavailable: the banner returns on the next load */
	}
}
