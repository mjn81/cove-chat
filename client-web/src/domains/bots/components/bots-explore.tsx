import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { useChannelStore } from '@/store/store';
import { useDebounce } from '@/hooks/use-debounce';
import { errorText } from '../hooks/use-bot-interaction';
import { useDiscoverBots, useStartBot } from '../hooks/use-bots';
import type { Bot } from '../types/bots.types';
import { BotBadge } from './bot-badge';

interface BotsExploreProps {
	/** The search box text; filters public bots by name or description. */
	query: string;
	/** Called with the DM's channel id once the chat with a bot is open. */
	onOpened: (channelId: string) => void;
}

/**
 * The Bots tab of Explore: public bots with avatar, name, BOT badge, description and command count. "Message"
 * starts the chat (the server opens or finds the DM and tells the bot, like a Start button) and opens it.
 */
export function BotsExplore({ query, onOpened }: BotsExploreProps) {
	const { t } = useTranslation();
	const debounced = useDebounce(query, 300);
	const { data, isFetching } = useDiscoverBots(debounced);
	const start = useStartBot();
	const [startingId, setStartingId] = useState<string | null>(null);

	const open = async (bot: Bot) => {
		if (startingId) return;
		setStartingId(bot.id);
		try {
			const res = await start.mutateAsync(bot.id);
			// The DM is new to this client: reload the list so it can be activated.
			await useChannelStore.getState().refreshChannels();
			if (!res.delivered) toast.info(t('bots.explore.offline', { bot: bot.username }));
			onOpened(res.channel_id);
		} catch (err) {
			toast.error(errorText(err, t('bots.composer.failed')));
		} finally {
			setStartingId(null);
		}
	};

	const items = data?.items ?? [];
	return (
		<div className="flex flex-col gap-1 pb-2">
			<div className="flex items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				{t('bots.explore.title')}
				{isFetching && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
			</div>
			{items.length === 0 && !isFetching && (
				<p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('bots.explore.empty')}</p>
			)}
			{items.map((bot) => (
				<div key={bot.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-accent/60">
					<div className="flex min-w-0 items-center gap-3">
						<Avatar userId={bot.id} avatarId={bot.avatar_id} size={36} />
						<div className="min-w-0">
							<div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
								<span className="truncate">{bot.username}</span>
								<BotBadge />
							</div>
							<div className="truncate text-xs text-muted-foreground">
								{bot.description || t('bots.explore.no_description')}
							</div>
							<div className="text-[11px] text-muted-foreground/80">
								{t('bots.explore.commands', { count: bot.command_count ?? 0 })}
							</div>
						</div>
					</div>
					<Button type="button" size="sm" className="h-8 shrink-0 px-3 text-xs" disabled={startingId === bot.id} onClick={() => void open(bot)}>
						{startingId === bot.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('bots.explore.start')}
					</Button>
				</div>
			))}
		</div>
	);
}
