import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${k}:${o.count}` : k) }) }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
vi.mock('@/store/store', () => ({ useChannelStore: { getState: () => ({ refreshChannels: vi.fn().mockResolvedValue(undefined) }) } }));
vi.mock('../hooks/use-bots', () => ({
	useDiscoverBots: () => ({
		isFetching: false,
		data: { items: [{ id: 'b1', username: 'dicebot', description: 'rolls dice', command_count: 3, public: true, disabled: false, online: true, install_count: 0, owner_id: 'o', created_at: '' }] },
	}),
	useStartBot: () => ({ mutateAsync: start }),
}));

import { BotsExplore } from './bots-explore';

describe('BotsExplore', () => {
	beforeEach(() => start.mockReset());

	it('lists a public bot with its badge, description and command count', () => {
		render(<BotsExplore query="" onOpened={() => undefined} />);
		expect(screen.getByText('dicebot')).toBeTruthy();
		expect(screen.getByText('bots.badge')).toBeTruthy();
		expect(screen.getByText('rolls dice')).toBeTruthy();
		expect(screen.getByText('bots.explore.commands:3')).toBeTruthy();
	});

	it('starts the chat and hands the DM id over', async () => {
		start.mockResolvedValue({ channel_id: 'dm1', created: true, delivered: true });
		const opened = vi.fn();
		render(<BotsExplore query="" onOpened={opened} />);
		fireEvent.click(screen.getByRole('button', { name: 'bots.explore.start' }));
		await waitFor(() => expect(opened).toHaveBeenCalledWith('dm1'));
		expect(start).toHaveBeenCalledWith('b1');
	});
});
