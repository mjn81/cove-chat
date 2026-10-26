import { useCallback } from 'react';

import { useChannelStore } from '@/store/channels.slice';
import type { Channel } from '@/types/api';
import { findDirectChannel } from '../utils/direct-message';

/**
 * Returns a function that makes `userId`'s DM the active conversation,
 * creating the channel first when there is none.
 *
 * @returns Async opener that resolves to the DM channel.
 * @throws If the channel has to be created and the server rejects it.
 */
export function useOpenDirectMessage() {
	const channels = useChannelStore((s) => s.channels);
	const createChannel = useChannelStore((s) => s.createChannel);
	const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

	return useCallback(
		async (userId: string): Promise<Channel> => {
			const dm = findDirectChannel(channels, userId) ?? (await createChannel('', [userId], true));
			setActiveChannel(dm);
			return dm;
		},
		[channels, createChannel, setActiveChannel],
	);
}
