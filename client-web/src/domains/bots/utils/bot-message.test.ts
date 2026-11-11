import { describe, expect, it } from 'vitest';

import { botMessagePreview, isSafeButtonUrl, parseBotMessage } from './bot-message';

describe('parseBotMessage', () => {
	it('reads text and buttons', () => {
		const body = parseBotMessage(
			JSON.stringify({
				v: 1,
				text: 'pick',
				buttons: [[{ label: 'Yes', custom_id: 'y', style: 'primary' }, { label: 'Docs', url: 'https://example.com' }]],
			}),
		);
		expect(body?.text).toBe('pick');
		expect(body?.buttons?.[0]).toHaveLength(2);
		expect(body?.buttons?.[0][0].style).toBe('primary');
	});

	it('returns null for anything that is not a bot body', () => {
		expect(parseBotMessage(undefined)).toBeNull();
		expect(parseBotMessage('plain text')).toBeNull();
		expect(parseBotMessage('[1,2]')).toBeNull();
		expect(parseBotMessage('{"v":1}')).toBeNull();
	});

	it('drops malformed and unsafe buttons instead of failing', () => {
		const body = parseBotMessage(
			JSON.stringify({
				text: 'x',
				buttons: [
					[
						{ label: 'both', custom_id: 'a', url: 'https://e.com' },
						{ label: 'neither' },
						{ label: 'js', url: 'javascript:alert(1)' },
						{ label: '  ', custom_id: 'b' },
						{ label: 'ok', custom_id: 'ok', style: 'weird' },
					],
					'not a row',
					[],
				],
			}),
		);
		expect(body?.buttons).toHaveLength(1);
		expect(body?.buttons?.[0]).toEqual([{ label: 'ok', style: 'secondary', custom_id: 'ok', url: undefined, disabled: false }]);
	});

	it('caps the grid at 5x5 like the server', () => {
		const row = Array.from({ length: 8 }, (_, i) => ({ label: `b${i}`, custom_id: `b${i}` }));
		const body = parseBotMessage(JSON.stringify({ text: 'x', buttons: Array.from({ length: 8 }, () => row) }));
		expect(body?.buttons).toHaveLength(5);
		expect(body?.buttons?.[0]).toHaveLength(5);
	});
});

describe('isSafeButtonUrl', () => {
	it('accepts only http and https', () => {
		expect(isSafeButtonUrl('https://example.com/a?b=1')).toBe(true);
		expect(isSafeButtonUrl('http://example.com')).toBe(true);
		for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.y', 'not a url', '//example.com']) {
			expect(isSafeButtonUrl(bad)).toBe(false);
		}
	});
});

describe('botMessagePreview', () => {
	it('returns the text or an empty string', () => {
		expect(botMessagePreview(JSON.stringify({ text: 'hello' }))).toBe('hello');
		expect(botMessagePreview('garbage')).toBe('');
	});
});
