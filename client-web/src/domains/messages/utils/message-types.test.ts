import { describe, expect, it } from 'vitest';
import { isKnownMessageType } from './message-types';

describe('isKnownMessageType', () => {
	it('accepts every renderable type', () => {
		for (const t of ['text', 'file', 'voice', 'video', 'invite']) expect(isKnownMessageType(t)).toBe(true);
	});

	it('rejects types from a newer server', () => {
		expect(isKnownMessageType('poll')).toBe(false);
		expect(isKnownMessageType('')).toBe(false);
	});
});
