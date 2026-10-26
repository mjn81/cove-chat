import { describe, expect, it } from 'vitest';

import { normalizeStatus, statusDotClass } from './status';

describe('normalizeStatus', () => {
	it('keeps the four known presence values', () => {
		expect(normalizeStatus('online')).toBe('online');
		expect(normalizeStatus('away')).toBe('away');
		expect(normalizeStatus('dnd')).toBe('dnd');
		expect(normalizeStatus('offline')).toBe('offline');
	});

	it('treats missing or unknown values (including "auto") as offline', () => {
		expect(normalizeStatus(undefined)).toBe('offline');
		expect(normalizeStatus(null)).toBe('offline');
		expect(normalizeStatus('auto')).toBe('offline');
		expect(normalizeStatus('???')).toBe('offline');
	});
});

describe('statusDotClass', () => {
	it('maps each presence to a semantic colour token', () => {
		expect(statusDotClass('online')).toBe('bg-success');
		expect(statusDotClass('away')).toBe('bg-warning');
		expect(statusDotClass('dnd')).toBe('bg-destructive');
		expect(statusDotClass('offline')).toBe('bg-muted-foreground');
		expect(statusDotClass(undefined)).toBe('bg-muted-foreground');
	});
});
