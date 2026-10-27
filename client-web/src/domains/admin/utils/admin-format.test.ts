import { describe, expect, it } from 'vitest';
import type { Invite } from '../types/admin.types';
import {
	formatBytes,
	formatInviteUses,
	formatUptime,
	liveInviteStatus,
	splitErrorKey,
	toRFC3339,
} from './admin-format';

const invite = (over: Partial<Invite>): Invite => ({
	code: 'ABC123',
	created_by: 'u1',
	created_at: '2026-01-01T00:00:00Z',
	expires_at: null,
	max_uses: 0,
	uses: 0,
	revoked: false,
	source: 'panel',
	status: 'active',
	...over,
});

describe('liveInviteStatus', () => {
	const now = Date.parse('2026-06-01T00:00:00Z');
	it('is active for an unlimited code without expiry', () => {
		expect(liveInviteStatus(invite({}), now)).toBe('active');
	});
	it('detects expiry, exhaustion and revocation', () => {
		expect(liveInviteStatus(invite({ expires_at: '2026-05-01T00:00:00Z' }), now)).toBe('expired');
		expect(liveInviteStatus(invite({ max_uses: 2, uses: 2 }), now)).toBe('exhausted');
		expect(liveInviteStatus(invite({ revoked: true }), now)).toBe('revoked');
	});
	it('prefers revoked over every other state', () => {
		expect(liveInviteStatus(invite({ revoked: true, max_uses: 1, uses: 1 }), now)).toBe('revoked');
	});
});

describe('formatting', () => {
	it('shows unlimited uses as infinity', () => {
		expect(formatInviteUses({ uses: 3, max_uses: 0 })).toBe('3 / ∞');
		expect(formatInviteUses({ uses: 3, max_uses: 10 })).toBe('3 / 10');
	});
	it('formats bytes and uptime', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatUptime(90000)).toBe('1d 1h');
		expect(formatUptime(3900)).toBe('1h 5m');
		expect(formatUptime(120)).toBe('2m');
	});
	it('converts datetime-local values', () => {
		expect(toRFC3339('')).toBeUndefined();
		expect(toRFC3339('nonsense')).toBeUndefined();
		expect(toRFC3339('2026-12-31T23:59')).toMatch(/^2026-1[12]-\d\dT.*Z$/);
	});
	it('splits backend error keys from their detail', () => {
		expect(splitErrorKey('admin.errors.forbidden')).toEqual({ key: 'admin.errors.forbidden' });
		expect(splitErrorKey('admin.errors.invalid_setting: a: must be text')).toEqual({
			key: 'admin.errors.invalid_setting',
			detail: 'a: must be text',
		});
	});
});
