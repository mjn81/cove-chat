import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { InteractionInput } from '../types/bots.types';
import { useSendInteraction } from './use-bots';

/** The message of a failed request: the (already localised) API error, else a generic fallback. */
export function errorText(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Sends interactions (button presses, keyboard keys, commands) to one bot and reports problems: a toast when the
 * request fails or when the bot is offline and nothing will answer.
 *
 * @param channelId - Channel the interaction happens in.
 * @param botId - The bot it is addressed to.
 * @param botName - The bot's name, for the "offline" toast.
 * @returns `send` (resolves true when the bot received it) and `pendingId`, the `custom_id` still waiting for the request.
 */
export function useBotInteraction(channelId: string, botId: string, botName: string) {
	const { t } = useTranslation();
	const mutation = useSendInteraction(channelId);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const send = useCallback(
		async (input: Omit<InteractionInput, 'bot_id'>): Promise<boolean> => {
			setPendingId(input.custom_id ?? null);
			try {
				const res = await mutation.mutateAsync({ ...input, bot_id: botId });
				if (!res.delivered) {
					toast.error(t('bots.composer.offline', { bot: botName }));
					return false;
				}
				return true;
			} catch (err) {
				toast.error(errorText(err, t('bots.composer.failed')));
				return false;
			} finally {
				setPendingId(null);
			}
		},
		[mutation, botId, botName, t],
	);

	return { send, pendingId };
}
