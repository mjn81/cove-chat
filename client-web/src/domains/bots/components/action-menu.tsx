import { Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useBotInteraction } from '../hooks/use-bot-interaction';
import type { BotKeyboard } from '../types/bots.types';
import { BotBadge } from './bot-badge';
import { BotButtonGrid } from './bot-button-grid';

interface ActionMenuProps {
	keyboard: BotKeyboard;
	channelId: string;
	/** The user wants to type instead; the composer shows its input again. */
	onSwitchToTyping: () => void;
	/** A key was pressed (successfully delivered); `one_time` keyboards close on it. */
	onPressed: () => void;
	className?: string;
}

/**
 * The bot's action menu: a glass button grid that REPLACES the composer's input area (like a reply keyboard). The
 * header names the bot and carries the button that switches back to typing.
 */
export function ActionMenu({ keyboard, channelId, onSwitchToTyping, onPressed, className }: ActionMenuProps) {
	const { t } = useTranslation();
	const { send, pendingId } = useBotInteraction(channelId, keyboard.bot_id, keyboard.bot_username);

	return (
		<section
			aria-label={t('bots.keyboard.label', { bot: keyboard.bot_username })}
			className={cn('bot-glass-panel overflow-hidden rounded-lg border border-border bg-secondary', className)}
		>
			<header className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
				<span className="truncate text-xs font-medium text-muted-foreground">
					{keyboard.placeholder || t('bots.keyboard.default_placeholder')}
				</span>
				<BotBadge className="ms-auto" />
				<button
					type="button"
					onClick={onSwitchToTyping}
					title={t('bots.keyboard.type')}
					aria-label={t('bots.keyboard.type')}
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<Keyboard size={16} />
				</button>
			</header>
			<div className="max-h-56 overflow-y-auto p-2">
				<BotButtonGrid
					variant="menu"
					rows={keyboard.rows}
					pendingId={pendingId}
					onPress={async (customId) => {
						const ok = await send({ type: 'keyboard', custom_id: customId });
						if (ok) onPressed();
					}}
				/>
			</div>
		</section>
	);
}
