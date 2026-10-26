import { useCallback, useState } from 'react';

import { useAuthStore } from '@/store/store';
import { useOpenDirectMessage } from '@/domains/channels/hooks/use-open-direct-message';
import { logger } from '@/utils/logger';
import type { RelationshipAction } from '@/types/api';

/**
 * Actions on an existing relationship (accept, decline, cancel, remove,
 * block, unblock) and "open DM", with a per-user loading flag so only the
 * clicked row is disabled.
 */
export function useFriendActions() {
	const relationshipAction = useAuthStore((s) => s.relationshipAction);
	const openDirectMessage = useOpenDirectMessage();
	const [loadingId, setLoadingId] = useState<string | null>(null);

	const act = useCallback(
		async (userId: string, action: RelationshipAction) => {
			setLoadingId(userId);
			try {
				await relationshipAction(userId, action);
			} catch (err) {
				logger.error(`Failed to perform ${action}`, { error: String(err) });
			} finally {
				setLoadingId(null);
			}
		},
		[relationshipAction],
	);

	/** Opens (or creates) the DM; returns whether it succeeded. */
	const startDM = useCallback(
		async (userId: string): Promise<boolean> => {
			try {
				await openDirectMessage(userId);
				return true;
			} catch (err) {
				logger.error('Failed to open DM', { error: String(err) });
				return false;
			}
		},
		[openDirectMessage],
	);

	return { loadingId, act, startDM };
}
