import { describe, expect, it } from 'vitest';
import { formatLocation, formatSessionSubtitleParts, relativeTimeParts } from './sessions-format';

describe('formatLocation', () => {
	it('joins city and country', () => {
		expect(formatLocation('Tehran', 'Iran')).toBe('Tehran, Iran');
	});
	it('falls back to whichever part exists', () => {
		expect(formatLocation('', 'Iran')).toBe('Iran');
		expect(formatLocation('Tehran', '')).toBe('Tehran');
	});
	it('returns an empty string when unknown', () => {
		expect(formatLocation(undefined, undefined)).toBe('');
	});
});

describe('relativeTimeParts', () => {
	const now = new Date('2026-10-29T12:00:00Z');
	it('treats the last minute as "now"', () => {
		expect(relativeTimeParts('2026-10-29T11:59:40Z', now)).toEqual({ unit: 'now', value: 0 });
	});
	it('uses minutes, hours and days', () => {
		expect(relativeTimeParts('2026-10-29T11:30:00Z', now)).toEqual({ unit: 'minute', value: 30 });
		expect(relativeTimeParts('2026-10-29T09:00:00Z', now)).toEqual({ unit: 'hour', value: 3 });
		expect(relativeTimeParts('2026-10-26T12:00:00Z', now)).toEqual({ unit: 'day', value: 3 });
	});
	it('never goes negative for clock skew', () => {
		expect(relativeTimeParts('2026-10-29T12:05:00Z', now)).toEqual({ unit: 'now', value: 0 });
	});
});

describe('formatSessionSubtitleParts', () => {
	it('lists app, IP and location, skipping empty parts', () => {
		expect(
			formatSessionSubtitleParts({ app_name: 'Cove Desktop 0.9.0', ip: '203.0.113.7', city: 'Tehran', country: 'Iran' }),
		).toEqual(['Cove Desktop 0.9.0', '203.0.113.7', 'Tehran, Iran']);
		expect(formatSessionSubtitleParts({ app_name: '', ip: '203.0.113.7' })).toEqual(['203.0.113.7']);
	});
});
