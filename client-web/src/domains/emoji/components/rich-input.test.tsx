import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { LoadedEmojiStyle } from '../types/emoji.types';

const style: LoadedEmojiStyle = {
	info: { id: 'noto' } as LoadedEmojiStyle['info'],
	sheetUrl: 'blob:noto',
	index: { size: 64, width: 6400, height: 6400, emoji: { '1f600': [0, 0], '1fae0': [64, 0], '1f44d-1f3fd': [128, 0] } },
};
vi.mock('../hooks/use-emoji', () => ({
	useLoadedEmojiStyle: (id?: string) => (id ? null : style),
	useFallbackStyleId: () => null,
}));

import { RichInput, type ComposerInputHandle } from './rich-input';

function Harness({ initial = '', onChange, handle }: { initial?: string; onChange?: (v: string, c: number) => void; handle?: React.Ref<ComposerInputHandle> }) {
	const [value, setValue] = useState(initial);
	return (
		<RichInput
			ref={handle}
			value={value}
			placeholder="Message"
			onValueChange={(v, c) => {
				setValue(v);
				onChange?.(v, c);
			}}
		/>
	);
}

const box = () => screen.getByRole('textbox');
const spans = () => Array.from(box().querySelectorAll('[data-emoji]')) as HTMLElement[];

describe('RichInput', () => {
	it('draws emoji from the value as sprites, including newer Unicode, with the real characters kept', () => {
		render(<Harness initial="hi 😀🫠👍🏽" />);
		expect(spans().map((s) => s.dataset.emoji)).toEqual(['😀', '🫠', '👍🏽']);
		for (const s of spans()) expect(s.style.backgroundImage).toContain('blob:noto');
		expect(box().textContent).toBe('hi 😀🫠👍🏽');
	});

	it('reports edits as plain text with the caret offset', () => {
		const onChange = vi.fn();
		render(<Harness initial="ab" onChange={onChange} />);
		box().appendChild(document.createTextNode('c'));
		fireEvent.input(box());
		expect(onChange).toHaveBeenLastCalledWith('abc', expect.any(Number));
	});

	it('turns an emoji typed or inserted by the OS panel into a sprite without changing the value', () => {
		const onChange = vi.fn();
		render(<Harness initial="a" onChange={onChange} />);
		box().appendChild(document.createTextNode('🫠'));
		fireEvent.input(box());
		expect(onChange).toHaveBeenLastCalledWith('a🫠', expect.any(Number));
		expect(spans().map((s) => s.dataset.emoji)).toEqual(['🫠']);
		expect(spans()[0].style.backgroundImage).toContain('blob:noto');
	});

	it('Shift+Enter inserts a newline; plain Enter is left to the parent and never edits', () => {
		const onKeyDown = vi.fn();
		const onChange = vi.fn();
		const { rerender } = render(<RichInput value="ab" placeholder="" onValueChange={onChange} onKeyDown={onKeyDown} />);
		const ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
		box().dispatchEvent(ev);
		expect(onKeyDown).toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith('ab\n', 3);
		const plain = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		box().dispatchEvent(plain);
		expect(plain.defaultPrevented).toBe(true);
		expect(onChange).toHaveBeenCalledTimes(1);
		rerender(<RichInput value="ab" placeholder="" onValueChange={onChange} />);
	});

	it('pastes plain text at the caret, replacing the selection', () => {
		const handle = createRef<ComposerInputHandle>();
		const onChange = vi.fn();
		render(<Harness initial="hello world" handle={handle} onChange={onChange} />);
		act(() => handle.current!.setSelectionRange(5, 11));
		fireEvent.paste(box(), { clipboardData: { getData: () => ' 😀\r\nok' } });
		expect(onChange).toHaveBeenLastCalledWith('hello 😀\nok', 11);
		expect(spans().map((s) => s.dataset.emoji)).toEqual(['😀']);
	});

	it('exposes the caret like a textarea', () => {
		const handle = createRef<ComposerInputHandle>();
		render(<Harness initial="a😀b" handle={handle} />);
		act(() => handle.current!.setSelectionRange(1, 3));
		expect(handle.current!.selectionStart).toBe(1);
		expect(handle.current!.selectionEnd).toBe(3);
		expect(handle.current!.contains(spans()[0])).toBe(true);
		expect(handle.current!.contains(document.body)).toBe(false);
	});

	it('redraws when the value changes from outside, and clears to an empty box (placeholder)', () => {
		const { rerender } = render(<RichInput value="😀" placeholder="Message" onValueChange={() => {}} />);
		expect(spans()).toHaveLength(1);
		rerender(<RichInput value="" placeholder="Message" onValueChange={() => {}} />);
		expect(box().childNodes.length).toBe(0);
		expect(box().getAttribute('data-placeholder')).toBe('Message');
	});

	it('is not editable when disabled', () => {
		render(<RichInput value="x" disabled placeholder="" onValueChange={() => {}} />);
		expect(box().getAttribute('contenteditable')).toBe('false');
	});
});
