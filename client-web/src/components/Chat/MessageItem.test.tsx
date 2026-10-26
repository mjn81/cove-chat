import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/ws', () => ({ wsEditMessage: vi.fn(), wsDeleteMessage: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('../Avatar', () => ({ Avatar: () => null }));
vi.mock('./FileBubble', () => ({ FileBubble: () => null }));
vi.mock('./VideoMessageBubble', () => ({ VideoMessageBubble: () => null }));
vi.mock('./JoinPreview', () => ({ JoinPreview: () => null }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));
vi.mock('../UserProfileModal', () => ({
	UserProfileModal: ({ userId }: { userId: string }) => <div data-testid="profile-modal">{userId}</div>,
}));
vi.mock('@/store/store', () => ({
	useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me', username: 'me' } }),
}));

import { MessageItem } from './MessageItem';
import type { Channel, Message } from '@/types/api';

const channel = {
	id: 'c1',
	name: 'general',
	members: ['me', 'u2'],
	member_names: { me: 'me', u2: 'Alice' },
} as unknown as Channel;

const msg = (text: string) =>
	({ id: 'm1', channel_id: 'c1', sender_id: 'u2', type: 'text', sent_at: new Date().toISOString(), text }) as Message & { text: string };

// jsdom has no PointerEvent, so synthesize pointerdown from a MouseEvent (carries button/clientX/clientY).
const pointerDown = (el: Element) => fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));

const renderItem = (text: string) =>
	render(<MessageItem msg={msg(text)} channel={channel} grouped={false} formatTime={() => '12:00'} />);

describe('MessageItem', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	});
	afterEach(() => vi.useRealTimers());

	it('opens the profile of a mentioned member when the mention is clicked', () => {
		renderItem('hi @alice there');
		expect(screen.queryByTestId('profile-modal')).toBeNull();
		fireEvent.click(screen.getByText('@alice'));
		expect(screen.getByTestId('profile-modal')).toHaveTextContent('u2');
	});

	it('copies the whole message on long press and confirms with a Copied pill', async () => {
		renderItem('plain message');
		const body = screen.getByText('plain message');
		pointerDown(body);
		await act(async () => void vi.advanceTimersByTime(600));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('plain message');
		expect(screen.getByRole('status')).toHaveTextContent('chat.copied');
		await act(async () => void vi.advanceTimersByTime(1500));
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('copies just the link when a link is long-pressed', async () => {
		renderItem('see https://example.com/x now');
		pointerDown(screen.getByText('https://example.com/x'));
		await act(async () => void vi.advanceTimersByTime(600));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/x');
	});
});
