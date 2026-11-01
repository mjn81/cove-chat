import { describe, expect, it } from 'vitest';

import { buildInviteUrl, encodeInvite, parseInvite } from './invite-message';

describe('encodeInvite / parseInvite', () => {
	it('round-trips the invite code and channel details', () => {
		const text = encodeInvite({ code: 'abc-123', name: 'Design', avatar_id: 'f1' });
		expect(parseInvite(text)).toEqual({ code: 'abc-123', name: 'Design', avatar_id: 'f1' });
	});

	it('keeps only the code when no details are given', () => {
		expect(parseInvite(encodeInvite({ code: 'abc' }))).toEqual({ code: 'abc' });
	});

	it('rejects anything that is not an invite body', () => {
		expect(parseInvite('hello')).toBeNull();
		expect(parseInvite('{"name":"x"}')).toBeNull();
		expect(parseInvite('{"code":""}')).toBeNull();
		expect(parseInvite('{"code":42}')).toBeNull();
		expect(parseInvite('[]')).toBeNull();
		expect(parseInvite('')).toBeNull();
	});

	it('refuses codes that could not be part of a join link', () => {
		expect(parseInvite('{"code":"a/b"}')).toBeNull();
		expect(parseInvite('{"code":"<script>"}')).toBeNull();
	});

	it('ignores fields of the wrong type', () => {
		expect(parseInvite('{"code":"abc","name":5,"avatar_id":{}}')).toEqual({ code: 'abc' });
	});
});

describe('buildInviteUrl', () => {
	it('uses the page origin in the browser', () => {
		expect(buildInviteUrl('abc', { desktop: false, serverUrl: 'http://x:4000', origin: 'https://chat.example.com' })).toBe(
			'https://chat.example.com/join/abc',
		);
	});

	it('uses the configured server in the desktop app, where the page origin is the app itself', () => {
		expect(buildInviteUrl('abc', { desktop: true, serverUrl: 'https://chat.example.com', origin: 'http://wails.localhost' })).toBe(
			'https://chat.example.com/join/abc',
		);
	});

	it('does not double the slash', () => {
		expect(buildInviteUrl('abc', { desktop: true, serverUrl: 'https://chat.example.com/', origin: '' })).toBe(
			'https://chat.example.com/join/abc',
		);
	});
});
