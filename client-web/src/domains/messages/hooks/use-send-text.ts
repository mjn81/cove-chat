import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAppStore, useAuthStore } from '@/store/store';
import {
	addPendingMessage,
	isPendingStillSending,
	markPendingFailed,
	removePendingMessage,
} from '@/utils/pendingMessages';
import { wsSendMessage } from '@/ws';

/** How long a text may stay "sending" before it is flagged as failed. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Returns a function that sends a text message with visible failure
 * feedback. `wsSendMessage()` always resolves, even when the socket is down
 * (it is a silent no-op deep in the socket layer), so without a local
 * placeholder a message typed while offline would simply vanish. The
 * placeholder shows a retry button if it is not confirmed in time.
 *
 * @param channelId - Channel the messages go to.
 */
export function useSendText(channelId: string) {
	const queryClient = useQueryClient();
	const userId = useAuthStore((s) => s.user?.id || '');
	// The retry button must call the latest sendText; a ref avoids referencing it before it is declared.
	const sendRef = useRef<(text: string, replyToId?: string) => void>(() => {});

	const sendText = useCallback(
		(text: string, replyToId?: string) => {
			const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			addPendingMessage(queryClient, channelId, {
				id: localId,
				channel_id: channelId,
				sender_id: userId,
				type: 'text',
				ciphertext: '',
				nonce: '',
				compression: 'none',
				sent_at: new Date().toISOString(),
				reply_to_id: replyToId,
				text,
				pending: 'sending',
				_retry: () => {
					removePendingMessage(queryClient, channelId, localId);
					sendRef.current(text, replyToId);
				},
			});

			if (useAppStore.getState().wsState !== 'connected') {
				markPendingFailed(queryClient, channelId, localId);
				return;
			}

			wsSendMessage(channelId, text, 'text', 'none', replyToId);

			setTimeout(() => {
				if (isPendingStillSending(queryClient, channelId, localId)) {
					markPendingFailed(queryClient, channelId, localId);
				}
			}, SEND_TIMEOUT_MS);
		},
		[channelId, userId, queryClient],
	);

	useEffect(() => {
		sendRef.current = sendText;
	}, [sendText]);

	return sendText;
}
