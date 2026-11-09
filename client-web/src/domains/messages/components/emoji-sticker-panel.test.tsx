import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/domains/emoji/components/emoji-picker-body', () => ({ default: ({ className }: { className?: string }) => <div data-testid="emoji" className={className} /> }));
vi.mock('@/domains/stickers/components/sticker-panel', () => ({ StickerPanel: () => <div data-testid="stickers" /> }));

import EmojiStickerPanel from './emoji-sticker-panel';

const noop = () => {};

describe('EmojiStickerPanel layout', () => {
	it('keeps one fixed box when switching tabs', () => {
		const { container } = render(<EmojiStickerPanel stickersEnabled onEmoji={noop} onSticker={noop} />);
		const root = container.firstElementChild as HTMLElement;
		const before = root.className;
		expect(before).toContain('h-[440px]');
		expect(before).toContain('w-full');
		expect(screen.getByTestId('emoji')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('tab', { name: 'emoji.panel.stickers' }));
		expect(screen.getByTestId('stickers')).toBeInTheDocument();
		expect(container.firstElementChild).toBe(root);
		expect(root.className).toBe(before);
	});

	it('marks the active tab and shows the short underline only under it', () => {
		render(<EmojiStickerPanel stickersEnabled onEmoji={noop} onSticker={noop} />);
		const [emoji, stickers] = screen.getAllByRole('tab');
		expect(emoji).toHaveAttribute('aria-selected', 'true');
		expect(stickers).toHaveAttribute('aria-selected', 'false');
		expect(emoji.querySelector('span')).not.toBeNull();
		expect(stickers.querySelector('span')).toBeNull();
	});

	it('uses the same box for the emoji-only panel of servers without stickers', () => {
		render(<EmojiStickerPanel stickersEnabled={false} onEmoji={noop} onSticker={noop} />);
		expect(screen.getByTestId('emoji').className).toContain('h-[440px]');
	});
});
