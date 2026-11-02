import { describe, expect, it } from 'vitest';
import {
	clientHeaderValue,
	compareVersions,
	hasCapability,
	isApiErrorCode,
	isBelowMinimum,
	parseErrorEnvelope,
} from './api-standard';

describe('clientHeaderValue', () => {
	it('formats platform, version and api version', () => {
		expect(clientHeaderValue('web', '0.9.9')).toBe('web/0.9.9 (api 2)');
	});
});

describe('parseErrorEnvelope', () => {
	it('reads a known code and the minimum version', () => {
		expect(
			parseErrorEnvelope({ error: 'x', code: 'client_outdated', details: { min_client_version: '1.0.0' } }),
		).toEqual({ code: 'client_outdated', minClientVersion: '1.0.0' });
	});

	it('drops unknown codes and survives garbage', () => {
		expect(parseErrorEnvelope({ code: 'from_the_future' })).toEqual({ code: undefined, minClientVersion: undefined });
		expect(parseErrorEnvelope(null)).toEqual({});
		expect(parseErrorEnvelope('oops')).toEqual({});
		expect(parseErrorEnvelope({ details: 5 })).toEqual({ code: undefined, minClientVersion: undefined });
	});

	it('isApiErrorCode only accepts registered codes', () => {
		expect(isApiErrorCode('rate_limited')).toBe(true);
		expect(isApiErrorCode('nope')).toBe(false);
		expect(isApiErrorCode(7)).toBe(false);
	});
});

describe('version comparison', () => {
	it('compares numerically, not lexically', () => {
		expect(compareVersions('0.9.10', '0.9.9')).toBe(1);
		expect(compareVersions('0.9.9', '0.9.9')).toBe(0);
		expect(compareVersions('v0.8.0-rc.1', '0.9.0')).toBe(-1);
	});

	it('returns null for non-versions', () => {
		expect(compareVersions('abc', '1.0.0')).toBeNull();
	});

	it('isBelowMinimum never flags an absent or invalid minimum', () => {
		expect(isBelowMinimum('0.9.0', undefined)).toBe(false);
		expect(isBelowMinimum('0.9.0', '')).toBe(false);
		expect(isBelowMinimum('0.9.0', 'soon')).toBe(false);
		expect(isBelowMinimum('0.9.0', '0.9.1')).toBe(true);
		expect(isBelowMinimum('0.9.1', '0.9.1')).toBe(false);
	});
});

describe('hasCapability', () => {
	it('treats a missing list (old server) as none', () => {
		expect(hasCapability(undefined, 'invite_messages')).toBe(false);
		expect(hasCapability([], 'invite_messages')).toBe(false);
		expect(hasCapability(['whisper', 'future_thing'], 'whisper')).toBe(true);
	});
});
