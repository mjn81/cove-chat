import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../components/emoji-sticker-panel', () => ({ default: () => <div data-testid="panel" /> }));
vi.mock('../utils/emoji-panel-loader', () => ({ loadPanel: () => import('../components/emoji-sticker-panel') }));

import { ComposerEmojiPanel } from './composer-emoji-panel';

const anchor = () => {
	const el = document.createElement('button');
	el.getBoundingClientRect = () => ({ left: 900, right: 932, top: 700, bottom: 732, width: 32, height: 32, x: 900, y: 700, toJSON: () => ({}) });
	return { current: el };
};

describe('ComposerEmojiPanel placement', () => {
	it('renders outside the composer, fixed to the window, so it cannot push or resize the layout', async () => {
		const { container, findByTestId } = render(
			<div data-testid="composer">
				<ComposerEmojiPanel open anchor={anchor()} stickersEnabled onEmoji={() => {}} onSticker={() => {}} onClose={() => {}} />
			</div>,
		);
		const panel = await findByTestId('panel');
		// Nothing is rendered inside the composer element itself.
		expect(container.querySelector('[data-testid="panel"]')).toBeNull();
		const box = panel.closest('.fixed') as HTMLElement;
		expect(box.parentElement).toBe(document.body);
		await vi.waitFor(() => expect(box.style.width).not.toBe(''));
		expect(box.hidden).toBe(false);
		expect(Number.parseFloat(box.style.left)).toBeGreaterThanOrEqual(8);
		expect(Number.parseFloat(box.style.top)).toBeGreaterThanOrEqual(8);
	});

	it('is hidden, not unmounted, when closed (reopening keeps scroll and is instant)', async () => {
		const { findByTestId } = render(<ComposerEmojiPanel open={false} anchor={anchor()} stickersEnabled onEmoji={() => {}} onSticker={() => {}} onClose={() => {}} />);
		const panel = await findByTestId('panel');
		expect((panel.closest('.fixed') as HTMLElement).hidden).toBe(true);
	});
});
