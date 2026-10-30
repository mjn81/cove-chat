import type { SessionInfo } from '../types/sessions.types';

/**
 * Joins a city and country into one display string.
 *
 * @returns "City, Country", whichever part exists, or an empty string when neither is known
 */
export function formatLocation(city?: string, country?: string): string {
	return [city, country].filter(Boolean).join(', ');
}

export type RelativeUnit = 'now' | 'minute' | 'hour' | 'day';

/**
 * Buckets how long ago `iso` was relative to `now` so the UI can pick a translated phrase.
 * The last minute counts as "now", and clock skew (a time in the future) never yields a negative value.
 */
export function relativeTimeParts(iso: string, now: Date = new Date()): { unit: RelativeUnit; value: number } {
	const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
	if (seconds < 60) return { unit: 'now', value: 0 };
	if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
	if (seconds < 86_400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
	return { unit: 'day', value: Math.floor(seconds / 86_400) };
}

/** The non-empty detail fragments shown under a device name: app, IP address, location. */
export function formatSessionSubtitleParts(s: Pick<SessionInfo, 'app_name' | 'ip' | 'city' | 'country'>): string[] {
	return [s.app_name, s.ip, formatLocation(s.city, s.country)].filter(Boolean);
}
