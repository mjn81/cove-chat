import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clear = vi.fn().mockResolvedValue({});
const del = vi.fn().mockResolvedValue({});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiClearHistory: (id: string) => clear(id), apiDeleteChannel: (...a: unknown[]) => del(...a) }));
vi.mock('@/components/ui/dropdown-menu', () => ({
	DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => <button onClick={onSelect}>{children}</button>,
}));
vi.mock('@/components/ConfirmModal', () => ({
	ConfirmModal: (p: { isOpen: boolean; onConfirm: () => void; title: string }) =>
		p.isOpen ? <button onClick={p.onConfirm}>confirm:{p.title}</button> : null,
}));
vi.mock('@/store/store', () => {
	const state = { removeChannel: vi.fn(), setActiveChannel: vi.fn(), refreshChannels: vi.fn(), relationshipAction: vi.fn() };
	return { useChannelStore: (sel: (s: typeof state) => unknown) => sel(state), useAuthStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

import { BotChatMenu } from './bot-chat-menu';

const channel = { id: 'dm1', name: '', members: ['me', 'bot'] } as never;

function setup() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<BotChatMenu channel={channel} botId="bot" botName="dicebot" />
		</QueryClientProvider>,
	);
}

describe('BotChatMenu', () => {
	beforeEach(() => { clear.mockClear(); del.mockClear(); });

	it('asks before clearing and then clears only that DM', async () => {
		setup();
		fireEvent.click(screen.getByText('bots.chat.clear'));
		expect(clear).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText('confirm:bots.chat.clear'));
		await waitFor(() => expect(clear).toHaveBeenCalledWith('dm1'));
	});

	it('removes the conversation for the caller only (no for_both)', async () => {
		setup();
		fireEvent.click(screen.getByText('bots.chat.remove'));
		fireEvent.click(screen.getByText('confirm:bots.chat.remove'));
		await waitFor(() => expect(del).toHaveBeenCalledWith('dm1', false));
	});
});
