import { BASE_URL } from '@/api/client';
import { isWails } from '@/utils/wails';
import { buildInviteUrl } from './invite-message';

/**
 * The shareable `/join/<code>` link for the current app, used only by "Copy invite" (the URL is never displayed).
 *
 * @param code - Channel invite code.
 */
export function currentInviteUrl(code: string): string {
	return buildInviteUrl(code, { desktop: isWails(), serverUrl: BASE_URL, origin: window.location.origin });
}
