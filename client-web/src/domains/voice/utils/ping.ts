/** Connection quality bucket shown next to the voice call controls. */
export type PingLevel = 'measuring' | 'good' | 'average' | 'poor';

/**
 * Buckets a round-trip time. Below 100 ms feels instant for voice, above
 * 250 ms conversation starts to overlap.
 *
 * @param ping - Round-trip time in ms, or `null` before the first measurement.
 */
export function pingLevel(ping: number | null): PingLevel {
	if (ping === null) return 'measuring';
	if (ping < 100) return 'good';
	if (ping < 250) return 'average';
	return 'poor';
}

/**
 * Human-readable latency. Values under 5 ms are shown as a floor because
 * the measurement is not that precise.
 *
 * @param ping - Round-trip time in ms.
 * @param compact - Drop the spaces (`48ms`) for tight layouts.
 */
export function formatPing(ping: number, compact = false): string {
	if (ping < 5) return compact ? '<5ms' : '< 5 ms';
	return compact ? `${ping}ms` : `${ping} ms`;
}

/** What the app-wide connection indicator shows: the socket state first, then latency quality. */
export type ConnectionLevel = 'offline' | 'connecting' | PingLevel;

/**
 * Resolves the indicator level for the WebSocket link.
 *
 * @param wsState - Socket lifecycle state from the app store.
 * @param ping - Latest heartbeat round trip in ms, or `null` when unmeasured.
 */
export function connectionLevel(wsState: string, ping: number | null): ConnectionLevel {
	if (wsState === 'connecting') return 'connecting';
	if (wsState !== 'connected') return 'offline';
	return pingLevel(ping);
}
