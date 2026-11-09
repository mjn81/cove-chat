import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { LoadedEmojiStyle } from '../types/emoji.types';

const style: LoadedEmojiStyle = {
	info: { id: 'noto' } as LoadedEmojiStyle['info'],
	sheetUrl: 'blob:noto',
	index: { size: 64, width: 640, height: 640, emoji: { '1f600': [64, 0] } },
};
let loaded: LoadedEmojiStyle | null = style;

vi.mock('../hooks/use-emoji', () => ({
	useLoadedEmojiStyle: (id?: string) => (id ? null : loaded),
	useFallbackStyleId: () => null,
}));

import { EmojiTextarea } from './emoji-textarea';

describe('EmojiTextarea', () => {
	it('keeps real Unicode in the value and draws a sprite mirror when the text has emoji', () => {
		const { container } = render(<EmojiTextarea value="hi 😀" onChange={() => {}} />);
		const ta = container.querySelector('textarea')!;
		expect(ta.value).toBe('hi 😀');
		expect(ta.style.color).toBe('transparent');
		const mirror = container.querySelector('[aria-hidden="true"]')!;
		expect(mirror.textContent).toBe('hi ');
		expect((mirror.querySelector('span') as HTMLElement).style.backgroundImage).toContain('blob:noto');
	});

	it('leaves the textarea untouched for text without emoji', () => {
		const { container } = render(<EmojiTextarea value="plain text" onChange={() => {}} />);
		expect(container.querySelector('textarea')!.style.color).toBe('');
		expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
	});

	it('does not hide the native glyphs while no sheet is loaded', () => {
		loaded = null;
		const { container } = render(<EmojiTextarea value="😀" onChange={() => {}} />);
		expect(container.querySelector('textarea')!.style.color).toBe('');
		expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
		loaded = style;
	});

	it('forwards its ref to the textarea', () => {
		const ref = { current: null as HTMLTextAreaElement | null };
		render(<EmojiTextarea ref={ref} value="x" onChange={() => {}} />);
		expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
	});
});
