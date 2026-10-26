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
