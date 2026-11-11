import { matchAutoLinkAt } from '@/utils/linkify';

/**
 * Safe, dependency-free Markdown subset shared by chat messages and release notes.
 *
 * The parser only ever produces a typed tree; the renderer builds React elements from it, so there is no HTML
 * string anywhere and raw HTML in the source stays literal text. Links are limited to http(s) and mailto.
 * The Android client implements the same grammar in `ui/components/Markdown.kt`; keep them in step.
 */

/** Inline node. */
export type InlineNode =
	| { type: 'text'; value: string }
	| { type: 'code'; value: string }
	| { type: 'bold' | 'italic' | 'strike'; children: InlineNode[] }
	| { type: 'link'; href: string; children: InlineNode[] }
	| { type: 'url' | 'email'; value: string; href: string }
	| { type: 'mention'; value: string };

/** Block node. */
export type BlockNode =
	| { type: 'text'; children: InlineNode[] }
	| { type: 'code'; value: string; lang: string }
	| { type: 'quote'; children: BlockNode[] }
	| { type: 'heading'; level: number; children: InlineNode[] }
	| { type: 'list'; ordered: boolean; start: number; items: BlockNode[][] }
	| { type: 'hr' };

/**
 * `chat` keeps every newline and only adds code blocks and quotes (so a typed `# not a title` or `- x` stays as typed);
 * `document` is the fuller CommonMark-ish subset used for GitHub release notes.
 */
export type MarkdownMode = 'chat' | 'document';

const MAX_DEPTH = 4;

/**
 * Returns the URL when it is safe to open (http, https or mailto), otherwise `null`.
 * Everything else (`javascript:`, `data:`, `file:`, relative paths, …) is refused.
 *
 * @param raw - A URL taken from message or release-note text.
 */
export function safeHref(raw: string): string | null {
	const url = raw.trim();
	if (!url || /[\s<>"]/.test(url) || [...url].some((ch) => ch.charCodeAt(0) < 32)) return null;
	try {
		const u = new URL(url);
		if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return u.href === url || u.href === `${url}/` ? url : u.href;
	} catch {
		// not an absolute URL
	}
	return null;
}

const PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Index of the matching `]` for the `[` at [open], honouring nesting and backslash escapes; -1 if none. */
function findBracketEnd(s: string, open: number): number {
	let depth = 0;
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (c === '\\') i++;
		else if (c === '`') {
			const end = s.indexOf('`', i + 1);
			if (end === -1) continue;
			i = end;
		} else if (c === '[') depth++;
		else if (c === ']' && --depth === 0) return i;
	}
	return -1;
}

/** Parses `(url "title")` at [open] and returns the URL and the index after `)`. */
function parseLinkTarget(s: string, open: number): { url: string; end: number } | null {
	let depth = 0;
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (c === '\\') i++;
		else if (c === '\n') return null;
		else if (c === '(') depth++;
		else if (c === ')' && --depth === 0) {
			let inner = s.slice(open + 1, i).trim();
			const title = /^(\S+)\s+("[^"]*"|'[^']*')$/.exec(inner);
			if (title) inner = title[1];
			if (inner.startsWith('<') && inner.endsWith('>')) inner = inner.slice(1, -1);
			return { url: inner, end: i + 1 };
		}
	}
	return null;
}

/** Index of the closing [delim] for an emphasis opened at [from] (content starts at `from`), or -1. */
function findClosing(s: string, from: number, delim: string): number {
	const intraword = delim[0] === '_';
	for (let i = from; i < s.length; i++) {
		const c = s[i];
		if (c === '\\') {
			i++;
			continue;
		}
		if (c === '`') {
			const end = s.indexOf('`', i + 1);
			if (end !== -1) i = end;
			continue;
		}
		if (!s.startsWith(delim, i)) continue;
		// A closer cannot follow whitespace, and a single `*`/`_` must not be half of a longer run.
		if (isSpace(s[i - 1]) || i === from) continue;
		if (delim.length === 1 && (s[i + 1] === delim || s[i - 1] === delim)) continue;
		// In a run like `***` the closer is the last two characters, so the inner single marker can close first.
		if (delim.length === 2 && s[i + 2] === delim[0]) continue;
		if (intraword && isWord(s[i + delim.length])) continue;
		return i;
	}
	return -1;
}

/**
 * Parses inline Markdown.
 *
 * @param s - Source text (may contain newlines, which stay inside text nodes).
 * @param inLink - True inside a link label, where auto-links and nested links are not produced.
 * @param depth - Emphasis nesting guard.
 */
export function parseInline(s: string, inLink = false, depth = 0): InlineNode[] {
	const out: InlineNode[] = [];
	let buf = '';
	const flush = () => {
		if (buf) {
			const prev = out[out.length - 1];
			if (prev?.type === 'text') prev.value += buf;
			else out.push({ type: 'text', value: buf });
			buf = '';
		}
	};

	let i = 0;
	while (i < s.length) {
		const c = s[i];

		if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) {
			buf += s[i + 1];
			i += 2;
			continue;
		}

		if (c === '`') {
			let run = 1;
			while (s[i + run] === '`') run++;
			const fence = '`'.repeat(run);
			const end = s.indexOf(fence, i + run);
			if (end !== -1 && s[end + run] !== '`') {
				let code = s.slice(i + run, end);
				if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
				flush();
				out.push({ type: 'code', value: code });
				i = end + run;
				continue;
			}
			buf += fence;
			i += run;
			continue;
		}

		if (!inLink && !isWord(s[i - 1]) && c !== '_' && c !== '*' && c !== '~' && c !== '[' && c !== '!') {
			const hit = matchAutoLinkAt(s, i);
			if (hit) {
				flush();
				out.push(hit.token);
				i += hit.length;
				continue;
			}
		}

		if (c === '!' && s[i + 1] === '[') {
			// Images are never fetched (privacy): the alt text stands in, linked if the target is safe.
			const end = findBracketEnd(s, i + 1);
			const target = end !== -1 && s[end + 1] === '(' ? parseLinkTarget(s, end + 1) : null;
			if (target) {
				const alt = s.slice(i + 2, end) || target.url;
				const href = safeHref(target.url);
				flush();
				out.push(
					href && !inLink
						? { type: 'link', href, children: [{ type: 'text', value: alt }] }
						: { type: 'text', value: alt },
				);
				i = target.end;
				continue;
			}
		}

		if (c === '[') {
			const end = findBracketEnd(s, i);
			const target = end !== -1 && s[end + 1] === '(' ? parseLinkTarget(s, end + 1) : null;
			if (target) {
				const label = s.slice(i + 1, end);
				const href = safeHref(target.url);
				flush();
				if (href && !inLink && label.trim()) {
					out.push({ type: 'link', href, children: parseInline(label, true, depth + 1) });
				} else {
					// Unsafe or empty target: keep the label as plain text so nothing clickable is created.
					out.push(...parseInline(label, true, depth + 1));
				}
				i = target.end;
				continue;
			}
		}

		if ((c === '*' || c === '_' || c === '~') && depth < MAX_DEPTH) {
			const double = s[i + 1] === c;
			const delim = double ? c + c : c;
			const kind = c === '~' ? (double ? 'strike' : null) : double ? 'bold' : 'italic';
			const after = s[i + delim.length];
			const opens = kind && !isSpace(after) && after !== c && !(c === '_' && isWord(s[i - 1]));
			if (opens) {
				const close = findClosing(s, i + delim.length, delim);
				if (close !== -1) {
					flush();
					out.push({ type: kind, children: parseInline(s.slice(i + delim.length, close), inLink, depth + 1) });
					i = close + delim.length;
					continue;
				}
			}
			// Not an opener: emit the whole run so `**` is not retried as two italics.
			let run = 1;
			while (s[i + run] === c) run++;
			buf += c.repeat(run);
			i += run;
			continue;
		}

		buf += c;
		i++;
	}
	flush();
	return out;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;

const indentOf = (s: string) => s.length - s.trimStart().length;

/**
 * Parses block structure.
 *
 * @param source - Message or release-note text.
 * @param mode - See {@link MarkdownMode}.
 */
export function parseMarkdown(source: string, mode: MarkdownMode = 'chat'): BlockNode[] {
	return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), mode, 0);
}

function parseBlocks(lines: string[], mode: MarkdownMode, depth: number): BlockNode[] {
	const doc = mode === 'document';
	const blocks: BlockNode[] = [];
	let text: string[] = [];

	const flushText = () => {
		if (!text.length) return;
		if (doc) {
			// Paragraphs are separated by blank lines; a soft break inside one is a plain newline.
			let para: string[] = [];
			const endPara = () => {
				if (para.length) blocks.push({ type: 'text', children: parseInline(para.join('\n')) });
				para = [];
			};
			for (const l of text) {
				if (l.trim()) para.push(l.trim());
				else endPara();
			}
			endPara();
		} else {
			// Chat keeps every character of the author's spacing, including blank lines.
			const joined = text.join('\n');
			if (joined.trim()) blocks.push({ type: 'text', children: parseInline(joined) });
		}
		text = [];
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		const fence = FENCE_OPEN.exec(line);
		if (fence) {
			const marker = fence[1];
			let end = -1;
			for (let j = i + 1; j < lines.length; j++) {
				const t = lines[j].trim();
				if (t.length >= marker.length && t[0] === marker[0] && /^[`~]+$/.test(t)) {
					end = j;
					break;
				}
			}
			if (end !== -1) {
				flushText();
				blocks.push({ type: 'code', value: lines.slice(i + 1, end).join('\n'), lang: fence[2] });
				i = end + 1;
				continue;
			}
		}

		if (depth < MAX_DEPTH && QUOTE.test(line)) {
			const inner: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i])) {
				inner.push(QUOTE.exec(lines[i])![1]);
				i++;
			}
			flushText();
			blocks.push({ type: 'quote', children: parseBlocks(inner, mode, depth + 1) });
			continue;
		}

		if (doc) {
			const heading = HEADING.exec(line);
			if (heading) {
				flushText();
				blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
				i++;
				continue;
			}
			if (HR.test(line)) {
				flushText();
				blocks.push({ type: 'hr' });
				i++;
				continue;
			}
			if (LIST_ITEM.test(line) && depth < MAX_DEPTH) {
				flushText();
				const [list, next] = parseList(lines, i, mode, depth);
				blocks.push(list);
				i = next;
				continue;
			}
		}

		text.push(line);
		i++;
	}
	flushText();
	return blocks;
}

/** Parses one list level starting at [start]; deeper-indented items nest inside the item above them. */
function parseList(lines: string[], start: number, mode: MarkdownMode, depth: number): [BlockNode, number] {
	const first = LIST_ITEM.exec(lines[start])!;
	const base = indentOf(lines[start]);
	const ordered = /\d/.test(first[2]);
	const items: BlockNode[][] = [];
	let i = start;

	while (i < lines.length) {
		const m = LIST_ITEM.exec(lines[i]);
		if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
		const body: string[] = [m[3]];
		i++;
		// Everything indented under the item (continuations, nested lists, code) belongs to it.
		while (i < lines.length) {
			const l = lines[i];
			if (!l.trim()) {
				const nextNonBlank = lines.slice(i + 1).find((x) => x.trim());
				if (nextNonBlank !== undefined && indentOf(nextNonBlank) > base) {
					body.push('');
					i++;
					continue;
				}
				break;
			}
			if (indentOf(l) > base) {
				body.push(l.slice(Math.min(indentOf(l), base + 2)));
				i++;
			} else if (!LIST_ITEM.test(l) && !HEADING.test(l) && !QUOTE.test(l) && !FENCE_OPEN.test(l) && body[body.length - 1] !== '') {
				body.push(l.trim()); // lazy continuation of the item's paragraph
				i++;
			} else break;
		}
		items.push(parseBlocks(body, mode, depth + 1));
		// A single blank line between items keeps the list going.
		if (i < lines.length && !lines[i].trim()) {
			const nxt = lines.slice(i).findIndex((x) => x.trim());
			if (nxt !== -1 && LIST_ITEM.test(lines[i + nxt]) && indentOf(lines[i + nxt]) === base) i += nxt;
		}
	}
	const startNum = ordered ? parseInt(first[2], 10) : 1;
	return [{ type: 'list', ordered, start: startNum, items }, i];
}

/** Plain-text rendering of inline nodes (markers removed), used for one-line previews. */
function inlineToPlain(nodes: InlineNode[]): string {
	return nodes
		.map((n) => {
			switch (n.type) {
				case 'text':
				case 'code':
				case 'url':
				case 'email':
				case 'mention':
					return n.value;
				default:
					return inlineToPlain(n.children);
			}
		})
		.join('');
}

function blockToPlain(b: BlockNode): string {
	switch (b.type) {
		case 'text':
		case 'heading':
			return inlineToPlain(b.children);
		case 'code':
			return b.value;
		case 'quote':
			return b.children.map(blockToPlain).join(' ');
		case 'list':
			return b.items.map((it) => it.map(blockToPlain).join(' ')).join(' ');
		default:
			return '';
	}
}

/**
 * Strips Markdown markers for single-line previews (reply bars, notifications) so `**hi**` shows as `hi`.
 *
 * @param source - Raw message text.
 * @returns The visible text with whitespace collapsed.
 */
export function stripMarkdown(source: string): string {
	return parseMarkdown(source, 'chat').map(blockToPlain).join(' ').replace(/\s+/g, ' ').trim();
}
