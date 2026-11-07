import { describe, expect, it } from 'vitest';

import { localizeApiErrorMessage } from './api-error-message';

const dict: Record<string, string> = {
	'apiErrors.channel_not_found': 'Channel not found.',
	'apiErrors.file_too_large': 'Too large (max {{detail}} MB).',
	'errors.unknown': 'Unknown error',
};
const t = (key: string, opts?: { detail?: string; defaultValue?: string }) => {
	const text = dict[key];
	if (text === undefined) return opts?.defaultValue ?? key;
	return text.replace('{{detail}}', opts?.detail ?? '');
};

describe('localizeApiErrorMessage', () => {
	it('translates an apiErrors key', () => {
		expect(localizeApiErrorMessage('apiErrors.channel_not_found', t)).toBe('Channel not found.');
	});

	it('passes the detail after ": " to the translation', () => {
		expect(localizeApiErrorMessage('apiErrors.file_too_large: 10', t)).toBe('Too large (max 10 MB).');
	});

	it('falls back to a generic message for an unknown apiErrors key', () => {
		expect(localizeApiErrorMessage('apiErrors.brand_new_thing', t)).toBe('Unknown error');
	});

	it('leaves plain messages and other key families alone', () => {
		expect(localizeApiErrorMessage('channel not found', t)).toBe('channel not found');
		expect(localizeApiErrorMessage('admin.errors.forbidden', t)).toBe('admin.errors.forbidden');
		expect(localizeApiErrorMessage('auth.errors.username_taken', t)).toBe('auth.errors.username_taken');
	});
});
