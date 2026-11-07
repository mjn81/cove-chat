import type { popup } from '@/wailsjs/go/models';

/** What a notification is about; decides how long the popup stays and what clicking it opens. */
export type NotificationKind = 'message' | 'call' | 'whisper';

/** Optional context a caller can attach to a notification. */
export interface DesktopNotificationOptions {
	kind?: NotificationKind;
	/** Chat to open when the popup is clicked. */
	channelId?: string;
	/** A newer notification with the same tag replaces the older one. */
	tag?: string;
	/** Lifetime override in milliseconds; 0 or unset lets the desktop app choose by kind. */
	ttlMs?: number;
}

/** The look of the app the popup should match. */
export interface NotificationAppearance {
	dark: boolean;
	/** Any BCP-47 tag; only the primary subtag is sent. */
	lang: string;
}

/**
 * Builds the payload for the desktop app's popup. The popup runs in its own web view with no access to the
 * app's settings, so the theme and language travel with the notification. It carries only the text the system
 * notification would have shown, plus the chat id used to open the right conversation on click.
 */
export function buildDesktopNotification(
	title: string,
	body: string,
	options: DesktopNotificationOptions,
	appearance: NotificationAppearance,
): popup.Request {
	return {
		title,
		body,
		kind: options.kind ?? 'message',
		channel_id: options.channelId ?? '',
		tag: options.tag ?? '',
		theme: appearance.dark ? 'dark' : 'light',
		lang: appearance.lang.split('-')[0],
		ttl_ms: options.ttlMs ?? 0,
	};
}
