import type { RelationshipResponse } from '@/types/api';

/** How the current user relates to another user, from the current user's point of view. */
export type RelationState = 'none' | 'friend' | 'requested' | 'incoming' | 'blocked';

/**
 * Works out the relationship to `userId` from the two lists the auth store
 * keeps: relationships the current user created, and requests addressed to
 * them. A block always wins over a pending incoming request, so a blocked
 * person can never be accepted by accident from a profile card.
 *
 * @param userId - The other user.
 * @param relationships - Outgoing relationships (friend / requested / blocked).
 * @param incomingRequests - Friend requests other users sent to the current user.
 */
export function getRelationState(
	userId: string,
	relationships: RelationshipResponse[],
	incomingRequests: RelationshipResponse[],
): RelationState {
	const outgoing = relationships.find((r) => r.to_user_id === userId);
	if (outgoing?.type === 'friend') return 'friend';
	if (outgoing?.type === 'requested') return 'requested';
	if (outgoing?.type === 'blocked') return 'blocked';
	if (incomingRequests.some((r) => r.from_user_id === userId)) return 'incoming';
	return 'none';
}
