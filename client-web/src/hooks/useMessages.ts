import { useInfiniteQuery } from '@tanstack/react-query';
import { apiListMessages } from '@/api/client';
import { decryptMessage } from '@/ws';
import { db, type CachedMessage } from '@/lib/db';
import { MAX_PAGE_LIMIT, pageItems } from '@/lib/paging';
import { nextMessageCursor, rememberMessageCursor } from '@/domains/messages/utils/message-cursors';
import { hasTextBody } from '@/domains/messages/utils/message-types';

const PAGINATION_LIMIT = MAX_PAGE_LIMIT;

export function useMessages(channelId: string) {
	return useInfiniteQuery({
		queryKey: ['messages', channelId],
		queryFn: async ({ pageParam }) => {
			const page = await apiListMessages(channelId, PAGINATION_LIMIT, pageParam as string | undefined);
			const msgs = pageItems(page);
			const decrypted: CachedMessage[] = await Promise.all(
				msgs.map(async (m) => ({
					...m,
					text: hasTextBody(m.type) ? await decryptMessage(m) : undefined,
				})),
			);
			
			if (decrypted.length > 0) {
				await db.cacheMessages(decrypted);
			}
			
			// The cursor is opaque and cannot live in the plain-array page the WebSocket handlers edit in place, so it
			// is remembered against this page's oldest message (see message-cursors.ts).
			rememberMessageCursor(channelId, decrypted, page.next_cursor);
			return decrypted; // backend returns newest-first
		},
		initialPageParam: undefined as string | undefined,
		// Undefined once the server stopped handing out a cursor (the start of the conversation was reached).
		getNextPageParam: (lastPage) => nextMessageCursor(channelId, lastPage),
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
