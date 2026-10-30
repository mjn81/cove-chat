import { describe, expect, it } from 'vitest';
import { validateNewPasscode } from './passcode';

describe('validateNewPasscode', () => {
	it('accepts a long-enough matching passcode', () => {
		expect(validateNewPasscode('abcd', 'abcd')).toBeNull();
	});
	it('rejects short passcodes before checking the match', () => {
		expect(validateNewPasscode('abc', 'xyz')).toBe('tooShort');
	});
	it('rejects a mismatched confirmation', () => {
		expect(validateNewPasscode('abcd', 'abce')).toBe('mismatch');
	});
	it('counts characters, not UTF-16 units', () => {
		expect(validateNewPasscode('🔒🔒🔒🔒', '🔒🔒🔒🔒')).toBeNull();
	});
});
