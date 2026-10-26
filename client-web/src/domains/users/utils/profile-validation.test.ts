import { describe, expect, it } from 'vitest';

import { sanitizeHexInput, validateUsername } from './profile-validation';

describe('validateUsername', () => {
	it('requires a non-empty name of at least 3 characters', () => {
		expect(validateUsername('')).toBe('empty');
		expect(validateUsername('   ')).toBe('empty');
		expect(validateUsername('ab')).toBe('short');
		expect(validateUsername('abc')).toBeNull();
		expect(validateUsername('  abc  ')).toBeNull();
	});
});

describe('sanitizeHexInput', () => {
	it('keeps only hex digits and limits to six', () => {
		expect(sanitizeHexInput('#5865f2zz')).toBe('5865f2');
		expect(sanitizeHexInput('12345678')).toBe('123456');
		expect(sanitizeHexInput('xyz')).toBe('');
	});
});
