import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/types/api';

// refreshChannels() previously had no request sequencing: two overlapping
// calls (e.g. triggered by two quick channel_key WS events) could resolve
// out of order, and whichever resolved LAST always won — even if it was the
// older, now-stale request — silently reverting the channel list.

const mockApiListChannels = vi.fn();
vi.mock('@/api/client', () => ({
	apiListChannels: () => mockApiListChannels(),
	apiCreateChannel: vi.fn(),
}));

vi.mock('@/ws', () => ({
	wsSendReadReceipt: vi.fn(),
}));

const { useChannelStore } = await import('./channels.slice');

function makeChannel(id: string, name: string): Channel {
	return { id, name } as Channel;
}

beforeEach(() => {
	vi.clearAllMocks();
	useChannelStore.setState({ channels: [], activeChannel: null, isChannelsLoading: false });
});

describe('channels.slice refreshChannels race handling', () => {
	it('keeps the result of the most recently STARTED call, even if an older call resolves later', async () => {
		let resolveFirst!: (channels: Channel[]) => void;
		let resolveSecond!: (channels: Channel[]) => void;

		const firstResponse = new Promise<Channel[]>((resolve) => {
			resolveFirst = resolve;
		});
		const secondResponse = new Promise<Channel[]>((resolve) => {
			resolveSecond = resolve;
		});

		mockApiListChannels
			.mockImplementationOnce(() => firstResponse)
			.mockImplementationOnce(() => secondResponse);

		const firstCall = useChannelStore.getState().refreshChannels();
		const secondCall = useChannelStore.getState().refreshChannels();

		// The SECOND (newer) request resolves first...
		resolveSecond([makeChannel('c2', 'Fresh Channel')]);
		await secondCall;

		// ...then the FIRST (older, now-stale) request resolves after it.
		resolveFirst([makeChannel('c1', 'Stale Channel')]);
		await firstCall;

		// The stale response must not overwrite the fresher one.
		const { channels } = useChannelStore.getState();
		expect(channels).toHaveLength(1);
		expect(channels[0].id).toBe('c2');
	});

	it('applies the result normally when calls are not overlapping', async () => {
		mockApiListChannels.mockResolvedValueOnce([makeChannel('c1', 'Only Channel')]);

		await useChannelStore.getState().refreshChannels();

		expect(useChannelStore.getState().channels).toHaveLength(1);
		expect(useChannelStore.getState().channels[0].id).toBe('c1');
	});

	it('removeChannel removes the specified channel and resets activeChannel if active', () => {
		const ch1 = makeChannel('c1', 'Channel 1');
		const ch2 = makeChannel('c2', 'Channel 2');
		useChannelStore.setState({
			channels: [ch1, ch2],
			activeChannel: ch1,
		});

		useChannelStore.getState().removeChannel('c1');

		const state = useChannelStore.getState();
		expect(state.channels).toHaveLength(1);
		expect(state.channels[0].id).toBe('c2');
		expect(state.activeChannel).toBeNull();
	});

	it('removeChannel preserves activeChannel if different channel is removed', () => {
		const ch1 = makeChannel('c1', 'Channel 1');
		const ch2 = makeChannel('c2', 'Channel 2');
		useChannelStore.setState({
			channels: [ch1, ch2],
			activeChannel: ch2,
		});

		useChannelStore.getState().removeChannel('c1');

		const state = useChannelStore.getState();
		expect(state.channels).toHaveLength(1);
		expect(state.channels[0].id).toBe('c2');
		expect(state.activeChannel?.id).toBe('c2');
	});
});
