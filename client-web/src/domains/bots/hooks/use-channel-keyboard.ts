import { useCallback } from 'react';

import { useBotUiStore } from '../store/bot-ui.store';
import { keyboardSignature, keyboardView, pickActiveKeyboard } from '../utils/keyboard';
import { useGetChannelKeyboards } from './use-bots';

/**
 * The action menu of a channel and how the composer should show it. The keyboards come from
 * `GET /api/channels/{id}/keyboards` and are kept live by the `keyboard_update` WebSocket event.
 *
 * @param channelId - The open channel.
 * @returns The active `keyboard` (or null), what to render (`view`), and the actions: `switchToTyping`, `showMenu`
 * and `onPressed` (closes `one_time` keyboards after a key press).
 */
export function useChannelKeyboard(channelId: string) {
	const { data } = useGetChannelKeyboards(channelId);
	const keyboard = pickActiveKeyboard(data?.items);
	const signature = keyboard ? keyboardSignature(keyboard) : '';
	const mode = useBotUiStore((s) => (s.modes[channelId]?.signature === signature ? s.modes[channelId].mode : undefined));
	const setMode = useBotUiStore((s) => s.setMode);

	const switchToTyping = useCallback(() => setMode(channelId, signature, 'typing'), [setMode, channelId, signature]);
	const showMenu = useCallback(() => setMode(channelId, signature, 'menu'), [setMode, channelId, signature]);
	const onPressed = useCallback(() => {
		if (keyboard?.one_time) setMode(channelId, signature, 'typing');
	}, [keyboard, setMode, channelId, signature]);

	return { keyboard, view: keyboardView(keyboard, mode), switchToTyping, showMenu, onPressed };
}
