import { describe, it, expect } from 'vitest';
import { tokenizeMessage } from './linkify';

describe('tokenizeMessage', () => {
	it('returns plain text untouched', () => {
		expect(tokenizeMessage('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
	});

	it('detects http(s) urls', () => {
		expect(tokenizeMessage('see https://example.com/a?b=1 now')).toEqual([
			{ type: 'text', value: 'see ' },
			{ type: 'url', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
			{ type: 'text', value: ' now' },
		]);
	});

	it('prefixes bare www links with https', () => {
		expect(tokenizeMessage('www.example.com')).toEqual([
			{ type: 'url', value: 'www.example.com', href: 'https://www.example.com' },
		]);
	});

	it('keeps trailing sentence punctuation out of the link', () => {
		expect(tokenizeMessage('go to https://example.com.')).toEqual([
			{ type: 'text', value: 'go to ' },
			{ type: 'url', value: 'https://example.com', href: 'https://example.com' },
			{ type: 'text', value: '.' },
		]);
	});

	it('keeps balanced parentheses inside the link but drops a closing one that wraps it', () => {
		const wiki = tokenizeMessage('https://en.wikipedia.org/wiki/Go_(game)');
		expect(wiki[0]).toMatchObject({ type: 'url', value: 'https://en.wikipedia.org/wiki/Go_(game)' });
		const wrapped = tokenizeMessage('(see https://example.com)');
		expect(wrapped.find((t) => t.type === 'url')).toMatchObject({ value: 'https://example.com' });
		expect(wrapped[wrapped.length - 1]).toEqual({ type: 'text', value: ')' });
	});

	it('detects emails as mailto links', () => {
		expect(tokenizeMessage('mail me@example.com please')).toEqual([
			{ type: 'text', value: 'mail ' },
			{ type: 'email', value: 'me@example.com', href: 'mailto:me@example.com' },
			{ type: 'text', value: ' please' },
		]);
	});

	it('keeps @mentions as their own tokens', () => {
		expect(tokenizeMessage('hi @alice!')).toEqual([
			{ type: 'text', value: 'hi ' },
			{ type: 'mention', value: '@alice' },
			{ type: 'text', value: '!' },
		]);
	});

	it('does not treat the local part of an email as a mention', () => {
		expect(tokenizeMessage('a@b.co')[0]).toMatchObject({ type: 'email' });
	});

	it('never produces javascript: or other schemes', () => {
		const tokens = tokenizeMessage('javascript:alert(1) ftp://x.com data:text/html,hi');
		expect(tokens.every((t) => t.type === 'text')).toBe(true);
	});
});
