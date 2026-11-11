import { useMemo } from 'react';

import { EmojiText } from '@/domains/emoji/components/emoji';
import { useBotInteraction } from '../hooks/use-bot-interaction';
import { parseBotMessage } from '../utils/bot-message';
import { BotButtonGrid } from './bot-button-grid';

interface BotMessageProps {
	/** Decrypted body (JSON) of the `bot` message. */
	text: string | undefined;
	messageId: string;
	channelId: string;
	botId: string;
	botName: string;
	pending?: boolean;
}

/** Renders a `bot` message: its text and its glass button grid. Callback buttons become interactions for the bot. */
export function BotMessage({ text, messageId, channelId, botId, botName, pending }: BotMessageProps) {
	const body = useMemo(() => parseBotMessage(text), [text]);
	const { send, pendingId } = useBotInteraction(channelId, botId, botName);
	if (!body) return <span className="text-sm italic text-muted-foreground">[…]</span>;
	return (
		<div className={pending ? 'opacity-60' : ''}>
			{body.text && (
				<div className="whitespace-pre-wrap break-words text-[15px] leading-[22px] text-foreground/90" dir="auto">
					<EmojiText text={body.text} em={1.25} />
				</div>
			)}
			{body.buttons && body.buttons.length > 0 && (
				<BotButtonGrid
					className="mt-1.5 max-w-md"
					rows={body.buttons}
					pendingId={pendingId}
					onPress={(customId) => void send({ type: 'button', message_id: messageId, custom_id: customId })}
				/>
			)}
		</div>
	);
}
