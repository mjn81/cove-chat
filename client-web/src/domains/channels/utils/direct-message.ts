import type { Channel } from '@/types/api';

/**
 * Finds the existing direct-message channel with `userId`. A DM is the
 * unnamed channel whose only members are the current user and that user.
 *
 * @param channels - Channels the current user belongs to.
 * @param userId - The other participant.
 * @returns The DM channel, or `undefined` if none exists yet.
 */
export function findDirectChannel(channels: Channel[], userId: string): Channel | undefined {
	return channels.find((c) => c.name === '' && c.members.length === 2 && c.members.includes(userId));
}
