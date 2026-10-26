/** Presence values the UI renders; anything else collapses to `offline`. */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

const KNOWN: ReadonlySet<string> = new Set<PresenceStatus>(['online', 'away', 'dnd', 'offline']);

/**
 * Maps a server-provided status string to a renderable presence. The account
 * setting `auto` is resolved server-side, so a raw `auto` or a missing value
 * is shown as offline rather than guessed.
 *
 * @param status - Status as stored on the user or channel member map.
 */
export function normalizeStatus(status?: string | null): PresenceStatus {
	return status && KNOWN.has(status) ? (status as PresenceStatus) : 'offline';
}

/**
 * Tailwind background token for a presence dot (shared by every sidebar,
 * topbar and search row so the colours cannot drift apart).
 *
 * @param status - Status as stored on the user or channel member map.
 */
export function statusDotClass(status?: string | null): string {
	switch (normalizeStatus(status)) {
		case 'online':
			return 'bg-success';
		case 'away':
			return 'bg-warning';
		case 'dnd':
			return 'bg-destructive';
		default:
			return 'bg-muted-foreground';
	}
}
