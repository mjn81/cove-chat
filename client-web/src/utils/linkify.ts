/** A piece of a chat message after link/mention detection. */
export type MessageToken =
	| { type: 'text'; value: string }
	| { type: 'mention'; value: string }
	| { type: 'url' | 'email'; value: string; href: string };

// Order matters: emails first so `me@example.com` is not split into a mention; URLs before mentions for `@` inside paths.
const TOKEN_RE =
	/([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)|((?:https?:\/\/|www\.)[^\s<>"']+)|(@\w+)/g;

const TRAILING_PUNCT = /[.,!?;:'"\]}]$/;

/** Counts occurrences of [ch] in [s]. */
const count = (s: string, ch: string) => s.split(ch).length - 1;

/**
 * Trims punctuation that belongs to the surrounding sentence rather than the link
 * (`https://x.com.` or `(see https://x.com)`), keeping balanced parentheses that are part of the URL.
 *
 * @param raw - The raw regex match for a URL.
 * @returns The link text and the characters trimmed from its end.
 */
function trimUrl(raw: string): { url: string; rest: string } {
	let url = raw;
	for (;;) {
		if (TRAILING_PUNCT.test(url)) url = url.slice(0, -1);
		else if (url.endsWith(')') && count(url, ')') > count(url, '(')) url = url.slice(0, -1);
		else break;
	}
	return { url, rest: raw.slice(url.length) };
}

/**
 * Splits message text into plain text, @mentions, URLs and email addresses.
 * Only `http(s)://`, `www.` and email forms become links, so `javascript:`/`data:` URLs can never be rendered as hrefs.
 *
 * @param text - Decrypted message body.
 * @returns Ordered tokens that concatenate back to the original text.
 */
export function tokenizeMessage(text: string): MessageToken[] {
	const tokens: MessageToken[] = [];
	let last = 0;
	const push = (value: string) => {
		if (!value) return;
		const prev = tokens[tokens.length - 1];
		if (prev?.type === 'text') prev.value += value;
		else tokens.push({ type: 'text', value });
	};

	for (const m of text.matchAll(TOKEN_RE)) {
		const start = m.index ?? 0;
		if (m[3] && start > 0 && /\w/.test(text[start - 1])) continue; // `foo@bar` inside a word
		push(text.slice(last, start));
		if (m[1]) {
			tokens.push({ type: 'email', value: m[1], href: `mailto:${m[1]}` });
		} else if (m[2]) {
			const { url, rest } = trimUrl(m[2]);
			tokens.push({ type: 'url', value: url, href: /^www\./i.test(url) ? `https://${url}` : url });
			push(rest);
		} else {
			tokens.push({ type: 'mention', value: m[3] });
		}
		last = start + m[0].length;
	}
	push(text.slice(last));
	return tokens;
}
