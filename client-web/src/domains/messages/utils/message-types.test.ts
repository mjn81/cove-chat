import { describe, expect, it } from 'vitest';
import { hasTextBody, isKnownMessageType } from './message-types';

describe('isKnownMessageType', () => {
	it('accepts every renderable type', () => {
		for (const t of ['text', 'file', 'voice', 'video', 'invite', 'sticker']) expect(isKnownMessageType(t)).toBe(true);
	});

	it('rejects types from a newer server', () => {
		expect(isKnownMessageType('poll')).toBe(false);
		expect(isKnownMessageType('')).toBe(false);
	});
});

describe('hasTextBody', () => {
	it('is true for types whose decrypted body is text or JSON shown by the client', () => {
		for (const t of ['text', 'invite', 'sticker']) expect(hasTextBody(t)).toBe(true);
	});

	it('is false for file-like and unknown types', () => {
		for (const t of ['file', 'voice', 'video', 'poll']) expect(hasTextBody(t)).toBe(false);
	});
});
