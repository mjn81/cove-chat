import { useInfiniteQuery } from '@tanstack/react-query';
import { apiListMessages } from '@/api/client';
import { decryptMessage } from '@/ws';
import { db, type CachedMessage } from '@/lib/db';

const PAGINATION_LIMIT = 250;

export function useMessages(channelId: string) {
	return useInfiniteQuery({
		queryKey: ['messages', channelId],
		queryFn: async ({ pageParam }) => {
			const msgs = await apiListMessages(channelId, PAGINATION_LIMIT, pageParam as string | undefined);
			const decrypted: CachedMessage[] = await Promise.all(
				msgs.map(async (m) => ({
					...m,
					text: m.type === 'text' ? await decryptMessage(m) : undefined,
				})),
			);
			
			if (decrypted.length > 0) {
				await db.cacheMessages(decrypted);
			}
			
			return decrypted; // backend returns newest-first
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => {
			if (lastPage.length < PAGINATION_LIMIT) return undefined;
			// Since lastPage is newest-first, the last element is the oldest.
			return lastPage[lastPage.length - 1].id;
		},
		staleTime: 0,
		refetchOnWindowFocus: true,
		// The app already gets live updates over the WebSocket and drives its
		// own reconnect logic off wsState (src/store/ws.manager.ts) — react-
		// query's own browser-'online'-triggered refetch is redundant and,
		// worse, replaces the cached page wholesale with the server's
		// response, silently deleting any client-only optimistic "sending"/
		// "failed" placeholders (src/utils/pendingMessages.ts) in the
		// process.
		refetchOnReconnect: false,
	});
}
