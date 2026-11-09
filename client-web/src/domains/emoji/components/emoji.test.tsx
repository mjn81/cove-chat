import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { LoadedEmojiStyle } from '../types/emoji.types';

const styles: Record<string, LoadedEmojiStyle | null> = { noto: null, twemoji: null };
let fallbackId: string | null = 'twemoji';

vi.mock('@/lib/asset-cache', () => ({ useAssetUrl: () => null }));
vi.mock('../hooks/use-emoji', () => ({
	useLoadedEmojiStyle: (id?: string, wanted = true) => (wanted ? (styles[id ?? 'noto'] ?? null) : null),
	useFallbackStyleId: () => fallbackId,
	useCustomEmoji: () => ({ names: new Set<string>(), byName: new Map() }),
}));

import { EmojiText } from './emoji';

const style = (id: string, keys: string[]): LoadedEmojiStyle => ({
	info: { id } as LoadedEmojiStyle['info'],
	sheetUrl: `blob:${id}`,
	index: { size: 64, width: 640, height: 640, emoji: Object.fromEntries(keys.map((k, i) => [k, [i * 64, 0] as [number, number]])) },
});

describe('EmojiText (sidebar previews, headers, quotes)', () => {
	it('draws known emoji from the sheet and keeps the character as copyable text', () => {
		styles.noto = style('noto', ['1f600']);
		const { container } = render(<EmojiText text="You: 😀 hi" size={13} />);
		const img = screen.getByRole('img', { name: '😀' });
		expect(img).toHaveStyle({ width: '13px', height: '13px' });
		expect(img.style.backgroundImage).toContain('blob:noto');
		expect(img.textContent).toBe('😀');
		expect(container.textContent).toBe('You: 😀 hi');
	});

	it('uses the fallback style for an emoji the active style lacks', () => {
		styles.noto = style('noto', ['1f600']);
		styles.twemoji = style('twemoji', ['1fae0']);
		render(<EmojiText text="🫠" size={13} />);
		expect(screen.getByRole('img', { name: '🫠' }).style.backgroundImage).toContain('blob:twemoji');
	});

	it('shows the plain glyph while no sheet is ready, never an empty box', () => {
		styles.noto = null;
		const { container } = render(<EmojiText text="😅 ok" size={13} />);
		expect(screen.queryByRole('img')).toBeNull();
		expect(container.textContent).toBe('😅 ok');
	});

	it('leaves text without emoji untouched', () => {
		const { container } = render(<EmojiText text="New login from localhost" />);
		expect(container.textContent).toBe('New login from localhost');
	});
});
