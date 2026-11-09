import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { useFallbackStyleId, useLoadedEmojiStyle } from '../hooks/use-emoji';
import { insertAtSelection } from '../utils/insert-text';
import { needsNormalize, renderValue, selectionOffsets, serializeInput, setSelectionOffsets } from '../utils/rich-input';
import { pickSprite } from '../utils/sprite';

/** The parts of a textarea the composer relies on, so existing caret logic keeps working unchanged. */
export interface ComposerInputHandle {
	focus: () => void;
	readonly selectionStart: number;
	readonly selectionEnd: number;
	setSelectionRange: (start: number, end?: number) => void;
	contains: (node: Node | null) => boolean;
}

interface RichInputProps {
	/** The text. Always real Unicode (and `:name:` shortcodes); never markup. */
	value: string;
	/** Called after every edit with the new value and the caret offset in it. */
	onValueChange: (value: string, caret: number) => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	'aria-label'?: string;
	'data-chat-input'?: boolean;
}

/**
 * The composer's text field. It is a contenteditable that draws every emoji as the selected style's sprite, exactly
 * like the message list does, so what is typed looks the same as what is sent on every platform, regardless of which
 * emoji the operating system's font can draw. The value stays a plain string: emoji spans carry the real character,
 * caret positions are string offsets (like a textarea's selectionStart), and copy, paste, drafts, mentions and
 * sending all see ordinary Unicode text. Pasted text is inserted as plain text; Shift+Enter inserts a newline.
 *
 * Input from the operating system's emoji panel or an IME arrives as characters and is turned into sprites as soon as
 * no composition is in progress, so composition itself is never interrupted.
 */
export const RichInput = forwardRef<ComposerInputHandle, RichInputProps>(function RichInput(
	{ value, onValueChange, onKeyDown, placeholder, disabled, className, ...rest },
	ref,
) {
	const el = useRef<HTMLDivElement>(null);
	/** The value currently drawn in the DOM. */
	const drawn = useRef('');
	const composing = useRef(false);
	/** Last known selection, kept because a contenteditable loses it when focus moves to the panel. */
	const lastSel = useRef<{ start: number; end: number } | null>(null);

	const loaded = useLoadedEmojiStyle();
	const fallbackId = useFallbackStyleId();
	const needsFallback = !!loaded && [...value].length > 0;
	const fallback = useLoadedEmojiStyle(fallbackId ?? undefined, needsFallback);
	const spriteFor = useCallback((key: string) => pickSprite(loaded, fallback, key, 1.35, 'em'), [loaded, fallback]);
	const latestSprite = useRef(spriteFor);
	const paintedWith = useRef(spriteFor);

	const remember = useCallback(() => {
		const node = el.current;
		const sel = node && selectionOffsets(node);
		if (sel) lastSel.current = sel;
	}, []);

	const paint = useCallback((next: string, caret?: { start: number; end: number }) => {
		const node = el.current;
		if (!node) return;
		renderValue(node, next, latestSprite.current);
		paintedWith.current = latestSprite.current;
		drawn.current = next;
		if (caret) {
			const max = next.length;
			setSelectionOffsets(node, Math.min(caret.start, max), Math.min(caret.end, max));
		}
	}, []);

	// Redraw when the value changed from outside (send clears it, a draft is restored, the panel inserts an emoji) or
	// when the sprite sheet finished loading.
	useLayoutEffect(() => {
		latestSprite.current = spriteFor;
		const node = el.current;
		if (!node) return;
		if (value === drawn.current && paintedWith.current === spriteFor) return;
		const focused = node.ownerDocument.activeElement === node;
		const sel = focused ? selectionOffsets(node) : null;
		paint(value, sel ?? undefined);
	}, [value, spriteFor, paint]);

	const commit = useCallback(
		(next: string, caret: number) => {
			drawn.current = next;
			lastSel.current = { start: caret, end: caret };
			onValueChange(next, caret);
		},
		[onValueChange],
	);

	const handleInput = () => {
		const node = el.current;
		if (!node) return;
		let next = serializeInput(node);
		if (next === '') node.replaceChildren(); // drop the stray <br> a browser leaves, so the placeholder shows
		else if (!composing.current && needsNormalize(node)) {
			const sel = selectionOffsets(node);
			paint(next, sel ?? undefined);
			next = serializeInput(node);
		}
		const sel = selectionOffsets(node);
		commit(next, sel?.end ?? next.length);
	};

	/** Inserts text at the caret (replacing a selection) and moves the caret after it. */
	const insert = (text: string) => {
		const node = el.current;
		if (!node) return;
		const cur = serializeInput(node);
		const sel = selectionOffsets(node) ?? lastSel.current ?? { start: cur.length, end: cur.length };
		const next = insertAtSelection(cur, sel.start, sel.end, text);
		paint(next.text, { start: next.caret, end: next.caret });
		commit(next.text, next.caret);
	};

	useImperativeHandle(
		ref,
		() => ({
			focus: () => el.current?.focus(),
			get selectionStart() {
				const node = el.current;
				return (node && selectionOffsets(node)?.start) ?? lastSel.current?.start ?? drawn.current.length;
			},
			get selectionEnd() {
				const node = el.current;
				return (node && selectionOffsets(node)?.end) ?? lastSel.current?.end ?? drawn.current.length;
			},
			setSelectionRange: (start, end = start) => {
				if (el.current) setSelectionOffsets(el.current, start, end);
				lastSel.current = { start, end };
			},
			contains: (node) => !!node && !!el.current?.contains(node),
		}),
		[],
	);

	return (
		<div
			{...rest}
			ref={el}
			role="textbox"
			aria-multiline="true"
			aria-disabled={disabled || undefined}
			contentEditable={!disabled}
			suppressContentEditableWarning
			data-placeholder={placeholder}
			dir="auto"
			spellCheck
			className={cn(
				'overflow-y-auto whitespace-pre-wrap break-words outline-none empty:before:pointer-events-none empty:before:text-muted-foreground/60 empty:before:content-[attr(data-placeholder)]',
				className,
			)}
			onInput={handleInput}
			onKeyUp={remember}
			onMouseUp={remember}
			onBlur={remember}
			onCompositionStart={() => {
				composing.current = true;
			}}
			onCompositionEnd={() => {
				composing.current = false;
				handleInput();
			}}
			onKeyDown={(e) => {
				onKeyDown?.(e);
				if (e.defaultPrevented) return;
				if (e.key === 'Enter') {
					e.preventDefault();
					if (e.shiftKey) insert('\n');
				}
			}}
			onPaste={(e) => {
				e.preventDefault();
				insert(e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
			}}
		/>
	);
});
