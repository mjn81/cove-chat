import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, safeHref, stripMarkdown } from './markdown';

describe('safeHref', () => {
	it('allows http, https and mailto only', () => {
		expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
		expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
		expect(safeHref('javascript:alert(1)')).toBeNull();
		expect(safeHref('  JaVaScRiPt:alert(1)')).toBeNull();
		expect(safeHref('data:text/html;base64,AAAA')).toBeNull();
		expect(safeHref('file:///etc/passwd')).toBeNull();
		expect(safeHref('/relative')).toBeNull();
		expect(safeHref('https://x.com/a b')).toBeNull();
	});
});

describe('parseInline', () => {
	it('parses bold, italic, strike and code', () => {
		expect(parseInline('a **b** *c* _d_ ~~e~~ `f`')).toEqual([
			{ type: 'text', value: 'a ' },
			{ type: 'bold', children: [{ type: 'text', value: 'b' }] },
			{ type: 'text', value: ' ' },
			{ type: 'italic', children: [{ type: 'text', value: 'c' }] },
			{ type: 'text', value: ' ' },
			{ type: 'italic', children: [{ type: 'text', value: 'd' }] },
			{ type: 'text', value: ' ' },
			{ type: 'strike', children: [{ type: 'text', value: 'e' }] },
			{ type: 'text', value: ' ' },
			{ type: 'code', value: 'f' },
		]);
	});

	it('leaves casual asterisks, snake_case and unmatched markers alone', () => {
		for (const s of ['2 * 3 * 4', 'snake_case_name', 'a ** b', '**unclosed', 'price is 5*', '~~']) {
			expect(parseInline(s)).toEqual([{ type: 'text', value: s }]);
		}
	});

	it('does not format inside code', () => {
		expect(parseInline('`**x**`')).toEqual([{ type: 'code', value: '**x**' }]);
	});

	it('supports backslash escapes', () => {
		expect(parseInline('\\*not italic\\*')).toEqual([{ type: 'text', value: '*not italic*' }]);
	});

	it('nests emphasis', () => {
		expect(parseInline('**a *b***')).toEqual([
			{ type: 'bold', children: [{ type: 'text', value: 'a ' }, { type: 'italic', children: [{ type: 'text', value: 'b' }] }] },
		]);
	});

	it('creates links only for safe targets', () => {
		expect(parseInline('[site](https://x.com)')).toEqual([
			{ type: 'link', href: 'https://x.com', children: [{ type: 'text', value: 'site' }] },
		]);
		// Unsafe target: only the label survives, nothing clickable.
		expect(parseInline('[click](javascript:alert(1))')).toEqual([{ type: 'text', value: 'click' }]);
	});

	it('does not auto-link inside a link label', () => {
		const [link] = parseInline('[https://a.com](https://b.com)');
		expect(link).toEqual({ type: 'link', href: 'https://b.com', children: [{ type: 'text', value: 'https://a.com' }] });
	});

	it('auto-links urls, emails and mentions and keeps markers out of them', () => {
		expect(parseInline('**https://x.com/a_b_c**')).toEqual([
			{ type: 'bold', children: [{ type: 'url', value: 'https://x.com/a_b_c', href: 'https://x.com/a_b_c' }] },
		]);
		expect(parseInline('hi @john_doe me@x.org')).toEqual([
			{ type: 'text', value: 'hi ' },
			{ type: 'mention', value: '@john_doe' },
			{ type: 'text', value: ' ' },
			{ type: 'email', value: 'me@x.org', href: 'mailto:me@x.org' },
		]);
	});

	it('keeps raw html as literal text', () => {
		expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ type: 'text', value: '<img src=x onerror=alert(1)>' }]);
	});

	it('turns images into their alt text, never an <img>', () => {
		expect(parseInline('![shot](https://x.com/a.png)')).toEqual([
			{ type: 'link', href: 'https://x.com/a.png', children: [{ type: 'text', value: 'shot' }] },
		]);
	});
});

describe('parseMarkdown (chat)', () => {
	it('keeps newlines and plain lines untouched', () => {
		expect(parseMarkdown('a\n\nb')).toEqual([{ type: 'text', children: [{ type: 'text', value: 'a\n\nb' }] }]);
	});

	it('does not turn # or - into headings or lists in chat', () => {
		expect(parseMarkdown('# hi\n- x')).toEqual([{ type: 'text', children: [{ type: 'text', value: '# hi\n- x' }] }]);
	});

	it('extracts fenced code with its language', () => {
		expect(parseMarkdown('before\n```ts\nconst a = 1;\n**x**\n```\nafter')).toEqual([
			{ type: 'text', children: [{ type: 'text', value: 'before' }] },
			{ type: 'code', lang: 'ts', value: 'const a = 1;\n**x**' },
			{ type: 'text', children: [{ type: 'text', value: 'after' }] },
		]);
	});

	it('treats an unclosed fence as text', () => {
		expect(parseMarkdown('```\nnope')).toEqual([{ type: 'text', children: [{ type: 'text', value: '```\nnope' }] }]);
	});

	it('parses quotes', () => {
		expect(parseMarkdown('> hi *there*\n> second')).toEqual([
			{
				type: 'quote',
				children: [
					{
						type: 'text',
						children: [
							{ type: 'text', value: 'hi ' },
							{ type: 'italic', children: [{ type: 'text', value: 'there' }] },
							{ type: 'text', value: '\nsecond' },
						],
					},
				],
			},
		]);
	});
});

describe('parseMarkdown (document)', () => {
	it('parses headings, paragraphs and rules', () => {
		expect(parseMarkdown('## Title\n\nline one\nline two\n\n---', 'document')).toEqual([
			{ type: 'heading', level: 2, children: [{ type: 'text', value: 'Title' }] },
			{ type: 'text', children: [{ type: 'text', value: 'line one\nline two' }] },
			{ type: 'hr' },
		]);
	});

	it('parses the release-please format with commit links', () => {
		const md = [
			'## [0.11.2](https://github.com/o/r/compare/v0.11.1...v0.11.2) (2026-11-10)',
			'',
			'### Features',
			'',
			'* **web:** add themes ([#12](https://github.com/o/r/issues/12)) ([abc1234](https://github.com/o/r/commit/abc1234))',
			'* plain item',
		].join('\n');
		const blocks = parseMarkdown(md, 'document');
		expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'list']);
		const list = blocks[2];
		if (list.type !== 'list') throw new Error('expected list');
		expect(list.items).toHaveLength(2);
		const first = list.items[0][0];
		if (first.type !== 'text') throw new Error('expected text');
		expect(first.children[0]).toEqual({ type: 'bold', children: [{ type: 'text', value: 'web:' }] });
		expect(first.children.filter((n) => n.type === 'link').map((n) => (n.type === 'link' ? n.href : ''))).toEqual([
			'https://github.com/o/r/issues/12',
			'https://github.com/o/r/commit/abc1234',
		]);
	});

	it('nests lists by indentation and supports ordered lists', () => {
		const blocks = parseMarkdown('1. one\n   - nested\n2. two', 'document');
		expect(blocks).toHaveLength(1);
		const list = blocks[0];
		if (list.type !== 'list') throw new Error('expected list');
		expect(list.ordered).toBe(true);
		expect(list.items).toHaveLength(2);
		expect(list.items[0].map((b) => b.type)).toEqual(['text', 'list']);
	});

	it('survives hostile input without throwing', () => {
		const nasty = '['.repeat(500) + '*'.repeat(500) + '`'.repeat(50) + '>'.repeat(20) + '\n- '.repeat(100);
		expect(() => parseMarkdown(nasty, 'document')).not.toThrow();
		expect(() => parseMarkdown(nasty, 'chat')).not.toThrow();
	});
});

describe('stripMarkdown', () => {
	it('removes markers for previews', () => {
		expect(stripMarkdown('**hi** `code` [x](https://a.b) ~~z~~')).toBe('hi code x z');
		expect(stripMarkdown('> quoted\n```\nblock\n```')).toBe('quoted block');
	});
});
