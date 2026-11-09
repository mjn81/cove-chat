import type { CSSProperties } from 'react';
import { tokenizeEmojiText } from './emoji-text';

/**
 * DOM helpers for the composer's rich input: a contenteditable whose text is real Unicode and whose emoji are drawn as
 * sprite spans (the same images the message list uses). The string value is the only source of truth; everything here
 * converts between that string and the DOM, so caret positions are plain string offsets as with a textarea.
 */

/** Attribute on an emoji span holding the real character. The span's own text repeats it, so copy gives Unicode. */
export const EMOJI_ATTR = 'data-emoji';
/** Marks the extra line break that keeps a trailing empty line visible; it is not part of the value. */
export const SENTINEL_ATTR = 'data-sentinel';

const isElement = (n: Node): n is HTMLElement => n.nodeType === 1;

/**
 * The string value of an input (or of a cloned fragment of it): text nodes as typed, `<br>` as a newline, emoji
 * spans as their character, and a block `<div>` (what some browsers insert for Enter) as a line break.
 *
 * @param root - The input element or a fragment.
 */
export function serializeInput(root: Node): string {
	let out = '';
	const walk = (node: Node) => {
		node.childNodes.forEach((child) => {
			if (child.nodeType === 3) out += child.nodeValue ?? '';
			else if (child.nodeName === 'BR') {
				if (!(isElement(child) && child.hasAttribute(SENTINEL_ATTR))) out += '\n';
			} else if (isElement(child) && child.hasAttribute(EMOJI_ATTR)) out += child.getAttribute(EMOJI_ATTR) ?? '';
			else if (isElement(child)) {
				if (child.nodeName === 'DIV' && out !== '' && !out.endsWith('\n')) out += '\n';
				walk(child);
			}
		});
	};
	walk(root);
	return out;
}

/** Number of string characters a node contributes to the value. */
function lengthOf(node: Node): number {
	return serializeInput({ childNodes: [node] } as unknown as Node).length;
}

/**
 * Converts a DOM position inside the input to a string offset.
 *
 * @param root - The input element.
 * @param node - Container of the position.
 * @param offset - Offset inside `node`.
 */
export function offsetOfPosition(root: HTMLElement, node: Node, offset: number): number {
	const range = document.createRange();
	range.selectNodeContents(root);
	try {
		range.setEnd(node, offset);
	} catch {
		return serializeInput(root).length;
	}
	return serializeInput(range.cloneContents()).length;
}

/**
 * The current selection as string offsets, or null when it is not inside the input.
 *
 * @param root - The input element.
 */
export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
	const sel = root.ownerDocument.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
	return {
		start: offsetOfPosition(root, range.startContainer, range.startOffset),
		end: offsetOfPosition(root, range.endContainer, range.endOffset),
	};
}

/**
 * Finds the DOM position for a string offset: inside a text node, or just before/after a `<br>` or emoji span.
 *
 * @param root - The input element.
 * @param target - String offset (clamped to the value length).
 */
export function locateOffset(root: HTMLElement, target: number): { node: Node; offset: number } {
	let remaining = Math.max(0, target);
	const find = (parent: Node): { node: Node; offset: number } | null => {
		const children = Array.from(parent.childNodes);
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const len = lengthOf(child);
			if (child.nodeType === 3) {
				if (remaining <= len) return { node: child, offset: remaining };
				remaining -= len;
			} else if (isElement(child) && (child.nodeName === 'BR' || child.hasAttribute(EMOJI_ATTR))) {
				if (remaining === 0) return { node: parent, offset: i };
				remaining -= len;
				if (remaining === 0 && i === children.length - 1) return { node: parent, offset: i + 1 };
			} else if (isElement(child)) {
				if (remaining <= len) return find(child) ?? { node: parent, offset: i + 1 };
				remaining -= len;
			}
		}
		return null;
	};
	return find(root) ?? { node: root, offset: root.childNodes.length };
}

/**
 * Moves the caret (or selects a range) using string offsets.
 *
 * @param root - The input element.
 * @param start - Start offset.
 * @param end - End offset (defaults to `start`).
 */
export function setSelectionOffsets(root: HTMLElement, start: number, end = start): void {
	const sel = root.ownerDocument.getSelection();
	if (!sel) return;
	const a = locateOffset(root, start);
	const b = locateOffset(root, end);
	const range = root.ownerDocument.createRange();
	range.setStart(a.node, a.offset);
	range.setEnd(b.node, b.offset);
	sel.removeAllRanges();
	sel.addRange(range);
}

/** Builds the span for one emoji. `sprite` is the image style, or null to leave the plain glyph visible. */
function emojiSpan(doc: Document, char: string, sprite: CSSProperties | null): HTMLElement {
	const span = doc.createElement('span');
	span.setAttribute(EMOJI_ATTR, char);
	span.contentEditable = 'false';
	span.textContent = char;
	if (sprite) {
		span.setAttribute('role', 'img');
		span.setAttribute('aria-label', char);
		span.style.display = 'inline-block';
		span.style.verticalAlign = 'text-bottom';
		span.style.overflow = 'hidden';
		span.style.color = 'transparent';
		span.style.width = '1.35em';
		span.style.height = '1.35em';
		span.style.fontSize = '1.1em';
		span.style.lineHeight = '1.35em';
		Object.assign(span.style, sprite);
	}
	return span;
}

/**
 * Rebuilds the input's DOM from a value: text and line breaks as they are, every emoji as a sprite span.
 *
 * @param root - The input element (its children are replaced).
 * @param value - The string value.
 * @param spriteFor - Image style for an emoji key at 1.35em, or null to show the glyph.
 */
export function renderValue(root: HTMLElement, value: string, spriteFor: (key: string) => CSSProperties | null): void {
	const doc = root.ownerDocument;
	const frag = doc.createDocumentFragment();
	for (const token of tokenizeEmojiText(value)) {
		if (token.type === 'emoji') {
			frag.appendChild(emojiSpan(doc, token.value, spriteFor(token.key)));
			continue;
		}
		token.value.split('\n').forEach((line, i) => {
			if (i > 0) frag.appendChild(doc.createElement('br'));
			if (line) frag.appendChild(doc.createTextNode(line));
		});
	}
	if (value.endsWith('\n')) {
		const sentinel = doc.createElement('br');
		sentinel.setAttribute(SENTINEL_ATTR, '');
		frag.appendChild(sentinel);
	}
	root.replaceChildren(frag);
}

/**
 * Whether typed or pasted text left emoji characters as plain text (for example from the OS emoji panel), which
 * should then be turned into sprite spans.
 *
 * @param root - The input element.
 */
export function needsNormalize(root: HTMLElement): boolean {
	let found = false;
	const walk = (node: Node) => {
		node.childNodes.forEach((child) => {
			if (found) return;
			if (child.nodeType === 3) {
				if (tokenizeEmojiText(child.nodeValue ?? '').some((t) => t.type === 'emoji')) found = true;
			} else if (isElement(child) && !child.hasAttribute(EMOJI_ATTR)) walk(child);
		});
	};
	walk(root);
	return found;
}
