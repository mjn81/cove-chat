import { describe, expect, it } from 'vitest';

import { buildDesktopNotification } from './desktop-notification';

describe('buildDesktopNotification', () => {
	it('carries the text, routing ids and the app look', () => {
		const req = buildDesktopNotification('Sam (#general)', 'hi', { kind: 'message', channelId: 'c1', tag: 't' }, { dark: false, lang: 'ar' });
		expect(req).toEqual({
			title: 'Sam (#general)',
			body: 'hi',
			subtitle: '',
			avatar: '',
			initial: '',
			tone: 0,
			system: false,
			kind: 'message',
			channel_id: 'c1',
			tag: 't',
			theme: 'light',
			lang: 'ar',
			ttl_ms: 0,
		});
	});

	it('defaults to a message with no routing and the dark theme', () => {
		const req = buildDesktopNotification('a', 'b', {}, { dark: true, lang: 'en-US' });
		expect(req.kind).toBe('message');
		expect(req.channel_id).toBe('');
		expect(req.theme).toBe('dark');
		expect(req.lang).toBe('en');
	});

	it('adds the sender avatar fields and subtitle', () => {
		const req = buildDesktopNotification(
			'Sam',
			'hi',
			{ subtitle: '#general', sender: { id: 'u1', name: 'Sam' } },
			{ dark: true, lang: 'en' },
			'data:image/jpeg;base64,AAAA',
		);
		expect(req.subtitle).toBe('#general');
		expect(req.avatar).toBe('data:image/jpeg;base64,AAAA');
		expect(req.initial).toBe('S');
	});

	it('lets a call stay until the popup default for calls applies', () => {
		expect(buildDesktopNotification('a', 'b', { kind: 'call', ttlMs: 20000 }, { dark: true, lang: 'fa' }).ttl_ms).toBe(20000);
	});
});
