// Optimistic local message placeholders shown while a send is in flight, and
// left in place with a "failed" state if it never gets confirmed. These are
// inserted directly into the same react-query cache shape ChatArea's
// addMessage() writes to (['messages', channelId], an infinite-query
// { pages: [...], pageParams: [...] } object), never persisted to
// IndexedDB or sent to the server.
import type { QueryClient } from '@tanstack/react-query';
import type { Message } from '@/types/api';

type PendingMessage = Message & { text?: string; _retry?: () => void };

function messagesKey(channelId: string) {
	return ['messages', channelId];
}

export function addPendingMessage(
	queryClient: QueryClient,
	channelId: string,
	msg: PendingMessage,
) {
	queryClient.setQueryData(messagesKey(channelId), (old: any) => {
		if (!old || !old.pages) return { pages: [[msg]], pageParams: [undefined] };
		const newPages = [...old.pages];
		newPages[0] = [msg, ...newPages[0]];
		return { ...old, pages: newPages };
	});
}

export function markPendingFailed(
	queryClient: QueryClient,
	channelId: string,
	localId: string,
) {
	queryClient.setQueryData(messagesKey(channelId), (old: any) => {
		if (!old || !old.pages) return old;
		return {
			...old,
			pages: old.pages.map((page: any[]) =>
				page.map((m) => (m.id === localId ? { ...m, pending: 'failed' } : m)),
			),
		};
	});
}

export function removePendingMessage(
	queryClient: QueryClient,
	channelId: string,
	localId: string,
) {
	queryClient.setQueryData(messagesKey(channelId), (old: any) => {
		if (!old || !old.pages) return old;
		return {
			...old,
			pages: old.pages.map((page: any[]) => page.filter((m) => m.id !== localId)),
		};
	});
}

export function isPendingStillSending(
	queryClient: QueryClient,
	channelId: string,
	localId: string,
): boolean {
	const data: any = queryClient.getQueryData(messagesKey(channelId));
	if (!data?.pages) return false;
	return data.pages.some((page: any[]) =>
		page.some((m) => m.id === localId && m.pending === 'sending'),
	);
}

// Called when a real server-echoed message for the current user arrives —
// removes the oldest still-'sending' placeholder for that channel so the
// real message takes its place instead of appearing as a duplicate.
export function resolveOldestPending(queryClient: QueryClient, channelId: string) {
	queryClient.setQueryData(messagesKey(channelId), (old: any) => {
		if (!old || !old.pages) return old;
		let removed = false;
		const pages = old.pages.map((page: any[]) =>
			page.filter((m) => {
				if (!removed && m.pending === 'sending') {
					removed = true;
					return false;
				}
				return true;
			}),
		);
		if (!removed) return old;
		return { ...old, pages };
	});
}
