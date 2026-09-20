import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { addPendingMessage, resolveOldestPending } from './pendingMessages';

const CHANNEL_ID = 'channel-1';

function messagesKey(channelId: string) {
	return ['messages', channelId];
}

function pendingMsg(id: string) {
	return {
		id,
		channel_id: CHANNEL_ID,
		sender_id: 'me',
		type: 'text' as const,
		ciphertext: '',
		nonce: '',
		compression: 'none',
		sent_at: new Date().toISOString(),
		pending: 'sending' as const,
	};
}

describe('resolveOldestPending', () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = new QueryClient();
	});

	it('removes the oldest (first-sent) placeholder, not the newest', () => {
		// Sending A, then B, then C in quick succession: addPendingMessage
		// prepends each new placeholder, so the cache ends up newest-first.
		addPendingMessage(queryClient, CHANNEL_ID, pendingMsg('A'));
		addPendingMessage(queryClient, CHANNEL_ID, pendingMsg('B'));
		addPendingMessage(queryClient, CHANNEL_ID, pendingMsg('C'));

		const before: any = queryClient.getQueryData(messagesKey(CHANNEL_ID));
		expect(before.pages[0].map((m: any) => m.id)).toEqual(['C', 'B', 'A']);

		// The server echoes messages back in the order they were actually
		// sent (A first), so the resolver must remove A's placeholder, not
		// the most-recently-added one (C).
		resolveOldestPending(queryClient, CHANNEL_ID);

		const after: any = queryClient.getQueryData(messagesKey(CHANNEL_ID));
		expect(after.pages[0].map((m: any) => m.id)).toEqual(['C', 'B']);
	});

	it('resolves multiple echoes in the correct oldest-first order', () => {
		addPendingMessage(queryClient, CHANNEL_ID, pendingMsg('A'));
		addPendingMessage(queryClient, CHANNEL_ID, pendingMsg('B'));
		addPendingMessage(queryClient, CHANNEL_ID, pendingMsg('C'));

		resolveOldestPending(queryClient, CHANNEL_ID); // should drop A
		resolveOldestPending(queryClient, CHANNEL_ID); // should drop B

		const after: any = queryClient.getQueryData(messagesKey(CHANNEL_ID));
		expect(after.pages[0].map((m: any) => m.id)).toEqual(['C']);
	});
});
