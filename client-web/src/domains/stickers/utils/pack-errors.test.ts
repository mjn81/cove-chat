import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/client', () => {
	class APIError extends Error {
		status: number;
		code?: string;
		constructor(status: number, message: string, data?: { code?: string }) {
			super(message);
			this.status = status;
			this.code = data?.code;
		}
	}
	return { APIError };
});

import { APIError } from '@/api/client';
import { packErrorKey, packErrorMessage } from './pack-errors';

const t = (k: string) => `T(${k})`;

describe('packErrorKey', () => {
	it('maps known codes to their message key', () => {
		expect(packErrorKey(new APIError(409, 'x', { code: 'pack_limit_reached' }))).toBe('stickers.errors.pack_limit_reached');
		expect(packErrorKey(new APIError(400, 'x', { code: 'image_invalid' }))).toBe('stickers.errors.image_invalid');
		expect(packErrorKey(new APIError(403, 'x', { code: 'pack_uploads_disabled' }))).toBe('stickers.errors.pack_uploads_disabled');
	});
	it('treats a 413 without a code as too large', () => {
		expect(packErrorKey(new APIError(413, 'big'))).toBe('stickers.errors.payload_too_large');
	});
	it('returns null for unknown codes and non-API errors', () => {
		expect(packErrorKey(new APIError(400, 'x', { code: 'something_new' }))).toBeNull();
		expect(packErrorKey(new Error('boom'))).toBeNull();
	});
});

describe('packErrorMessage', () => {
	it('prefers the translation, then the server message, then a generic one', () => {
		expect(packErrorMessage(new APIError(409, 'Pack limit', { code: 'pack_limit_reached' }), t)).toBe('T(stickers.errors.pack_limit_reached)');
		expect(packErrorMessage(new APIError(400, 'Name too long'), t)).toBe('Name too long');
		expect(packErrorMessage(new Error('boom'), t)).toBe('T(stickers.errors.generic)');
	});
});
