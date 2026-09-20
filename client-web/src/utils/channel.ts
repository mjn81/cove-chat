import type { Channel } from '@/types/api';

/**
 * Determines if a channel is a Direct Message based on membership count and name.
 */
export function isDirectMessage(channel: Channel): boolean {
	return (
		channel.members.length === 2 &&
		(!channel.name || channel.name.trim() === '')
	);
}

export function getChannelDisplayName(
	ch: Channel,
	currentUserId: string,
): string {
	if (isDirectMessage(ch)) {
		const otherId = ch.members.find((m: string) => m !== currentUserId);
		if (otherId && ch.member_names && ch.member_names[otherId]) {
			return ch.member_names[otherId];
		}
		return otherId || 'Unknown';
	}
	return ch.name || `Group (${ch.members.length})`;
}
