import { useCallback } from 'react';

import { useAppStore } from '@/store/store';
import { encodeSticker } from '@/domains/stickers/utils/sticker-message';
import type { PackItem } from '@/domains/stickers/types/stickers.types';
import { wsSendMessage } from '@/ws';

/**
 * Returns a function that sends a sticker as a `sticker` message (the body is the JSON from `encodeSticker`, encrypted
 * like any message). The server validates it against the pack, so a rejected sticker comes back as a `message_error`.
 *
 * @param channelId - Channel the sticker goes to.
 * @returns `send(packId, item, replyToId?)`, resolving to false when the socket is down or the send failed.
 */
export function useSendSticker(channelId: string) {
	return useCallback(
		async (packId: string, item: Pick<PackItem, 'id' | 'file_id'>, replyToId?: string): Promise<boolean> => {
			if (useAppStore.getState().wsState !== 'connected') return false;
			return wsSendMessage(channelId, encodeSticker(packId, item), 'sticker', 'none', replyToId);
		},
		[channelId],
	);
}
