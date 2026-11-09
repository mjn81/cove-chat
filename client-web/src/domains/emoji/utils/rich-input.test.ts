import { describe, it, expect, beforeEach } from 'vitest';
import data from '@emoji-mart/data';

import { emojiKey } from './emoji-text';
import { EMOJI_ATTR, locateOffset, needsNormalize, renderValue, selectionOffsets, serializeInput, setSelectionOffsets } from './rich-input';

const sprite = () => ({ backgroundImage: 'url("blob:x")' });
let root: HTMLElement;

beforeEach(() => {
	document.body.innerHTML = '<div id="r" contenteditable="true"></div>';
	root = document.getElementById('r')!;
});

describe('renderValue / serializeInput', () => {
	it('round-trips text, newlines and emoji exactly', () => {
		for (const value of ['', 'hello', 'a\nb', 'hi 😀 there', '👍🏽🇩🇪1️⃣❤️‍🔥', 'x\n', '\n\n', 'a 😀\n😀 b']) {
			renderValue(root, value, sprite);
			expect(serializeInput(root), JSON.stringify(value)).toBe(value);
		}
	});

	it('draws every emoji as its own sprite span that still carries the real character', () => {
		renderValue(root, '😀👍🏽❤️', sprite);
		const spans = Array.from(root.querySelectorAll(`[${EMOJI_ATTR}]`)) as HTMLElement[];
		expect(spans.map((s) => s.getAttribute(EMOJI_ATTR))).toEqual(['😀', '👍🏽', '❤️']);
		for (const s of spans) {
			expect(s.style.backgroundImage).toContain('blob:x');
			expect(s.textContent).toBe(s.getAttribute(EMOJI_ATTR));
			expect(s.contentEditable).toBe('false');
		}
	});

	it('leaves the glyph visible when there is no sprite', () => {
		renderValue(root, '🫠', () => null);
		const span = root.querySelector(`[${EMOJI_ATTR}]`) as HTMLElement;
		expect(span.style.color).toBe('');
		expect(span.textContent).toBe('🫠');
	});

	it('inserts no invisible filler characters', () => {
		const value = '😀😀 a\n🫠';
		renderValue(root, value, sprite);
		const text = root.textContent ?? '';
		expect(text).not.toMatch(new RegExp('[\u200b\u2060\ufeff]'));
		expect(serializeInput(root)).toBe(value);
	});

	it('treats a browser-inserted block as a line break', () => {
		root.innerHTML = 'one<div>two</div><div>three</div>';
		expect(serializeInput(root)).toBe('one\ntwo\nthree');
	});
});

describe('every emoji in the data set', () => {
	type Raw = { id: string; skins: { native: string }[] };
	const all = Object.values((data as unknown as { emojis: Record<string, Raw> }).emojis).flatMap((e) => e.skins.map((s) => s.native));

	it('renders as exactly one visible element each, newest Unicode versions included, with an exact value', () => {
		expect(all.length).toBeGreaterThan(3000);
		const value = all.join(' ');
		renderValue(root, value, sprite);
		const spans = root.querySelectorAll(`[${EMOJI_ATTR}]`);
		expect(spans.length).toBe(all.length);
		expect(serializeInput(root)).toBe(value);
	});

	it('keeps the newest emoji (Unicode 14 and 15) as single units', () => {
		for (const e of ['🫠', '🫡', '🫥', '🥲', '🫨', '🫷', '🫎', '🪿', '😮‍💨', '🫱🏽‍🫲🏿']) {
			renderValue(root, e + e, sprite);
			const spans = Array.from(root.querySelectorAll(`[${EMOJI_ATTR}]`)).map((s) => s.getAttribute(EMOJI_ATTR));
			expect(spans, e).toEqual([e, e]);
			expect(emojiKey(e).length).toBeGreaterThan(0);
		}
	});
});

describe('caret offsets', () => {
	it('maps string offsets to DOM positions and back, across emoji and line breaks', () => {
		const value = 'ab😀c\nd👍🏽';
		renderValue(root, value, sprite);
		const lengths = [0, 1, 2, 4, 5, 6, 7, 11];
		for (const off of lengths) {
			setSelectionOffsets(root, off);
			expect(selectionOffsets(root), `offset ${off}`).toEqual({ start: off, end: off });
		}
	});

	it('selects ranges', () => {
		renderValue(root, 'hi 😀 yo', sprite);
		setSelectionOffsets(root, 1, 6);
		expect(selectionOffsets(root)).toEqual({ start: 1, end: 6 });
	});

	it('locates the end of the value', () => {
		renderValue(root, 'ab😀', sprite);
		const pos = locateOffset(root, 99);
		expect(pos.node).toBe(root);
	});

	it('reports no selection when it is elsewhere', () => {
		renderValue(root, 'text', sprite);
		document.getSelection()?.removeAllRanges();
		expect(selectionOffsets(root)).toBeNull();
	});
});

describe('needsNormalize', () => {
	it('is true only when emoji are loose characters in text nodes', () => {
		renderValue(root, 'a😀', sprite);
		expect(needsNormalize(root)).toBe(false);
		root.appendChild(document.createTextNode('🫠'));
		expect(needsNormalize(root)).toBe(true);
	});
});
