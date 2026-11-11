import { describe, expect, it } from 'vitest';

import { connectionLevel, formatPing, pingLevel } from './ping';

describe('pingLevel', () => {
	it('is "measuring" until a value arrives', () => {
		expect(pingLevel(null)).toBe('measuring');
	});

	it('classifies by round-trip time', () => {
		expect(pingLevel(0)).toBe('good');
		expect(pingLevel(99)).toBe('good');
		expect(pingLevel(100)).toBe('average');
		expect(pingLevel(249)).toBe('average');
		expect(pingLevel(250)).toBe('poor');
	});
});

describe('formatPing', () => {
	it('shows sub-5ms values as a floor', () => {
		expect(formatPing(2)).toBe('< 5 ms');
		expect(formatPing(2, true)).toBe('<5ms');
	});

	it('shows regular values with the unit', () => {
		expect(formatPing(48)).toBe('48 ms');
		expect(formatPing(48, true)).toBe('48ms');
	});
});

describe('connectionLevel', () => {
	it('puts the socket state before latency', () => {
		expect(connectionLevel('disconnected', 20)).toBe('offline');
		expect(connectionLevel('connecting', 20)).toBe('connecting');
	});

	it('falls through to the latency bucket once connected', () => {
		expect(connectionLevel('connected', null)).toBe('measuring');
		expect(connectionLevel('connected', 30)).toBe('good');
		expect(connectionLevel('connected', 180)).toBe('average');
		expect(connectionLevel('connected', 900)).toBe('poor');
	});
});
