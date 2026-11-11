import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Eraser, MoreVertical, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ConfirmModal } from '@/components/ConfirmModal';
import { IconButton } from '@/components/icon-button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiClearHistory, apiDeleteChannel } from '@/api/client';
import { useAuthStore, useChannelStore } from '@/store/store';
import type { Channel } from '@/types/api';
import { errorText } from '../hooks/use-bot-interaction';

interface BotChatMenuProps {
	/** The DM with the bot. */
	channel: Channel;
	botId: string;
	botName: string;
}

type Action = 'clear' | 'remove' | 'block';

/**
 * The "more" menu of a DM with a bot: clear history (your side only, the chat stays listed), remove the conversation
 * from your list (Start in Explore brings it back) and block the bot. Each asks for confirmation first.
 */
export function BotChatMenu({ channel, botId, botName }: BotChatMenuProps) {
	const { t } = useTranslation();
	const qc = useQueryClient();
	const removeChannel = useChannelStore((s) => s.removeChannel);
	const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
	const refreshChannels = useChannelStore((s) => s.refreshChannels);
	const relationshipAction = useAuthStore((s) => s.relationshipAction);
	const [pending, setPending] = useState<Action | null>(null);

	const run = async () => {
		const action = pending;
		if (!action) return;
		try {
			if (action === 'clear') {
				await apiClearHistory(channel.id);
				await qc.invalidateQueries({ queryKey: ['messages', channel.id] });
				void refreshChannels();
				toast.success(t('bots.chat.cleared'));
			} else if (action === 'remove') {
				await apiDeleteChannel(channel.id, false);
				removeChannel(channel.id);
				setActiveChannel(null);
				toast.success(t('bots.chat.removed'));
			} else {
				await relationshipAction(botId, 'block');
				toast.success(t('bots.chat.blocked', { bot: botName }));
			}
		} catch (err) {
			toast.error(errorText(err, t('bots.composer.failed')));
		}
	};

	const copy: Record<Action, { title: string; message: string; confirm: string }> = {
		clear: { title: t('bots.chat.clear'), message: t('bots.chat.clear_message', { bot: botName }), confirm: t('bots.chat.clear') },
		remove: { title: t('bots.chat.remove'), message: t('bots.chat.remove_message', { bot: botName }), confirm: t('bots.chat.remove') },
		block: { title: t('bots.chat.block'), message: t('bots.chat.block_message', { bot: botName }), confirm: t('bots.chat.block') },
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton label={t('bots.chat.menu')}>
						<MoreVertical size={20} />
					</IconButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => setPending('clear')}>
						<Eraser size={16} />
						{t('bots.chat.clear')}
					</DropdownMenuItem>
					<DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => setPending('remove')}>
						<Trash2 size={16} />
						{t('bots.chat.remove')}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
						onSelect={() => setPending('block')}
					>
						<Ban size={16} />
						{t('bots.chat.block')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmModal
				isOpen={pending !== null}
				onClose={() => setPending(null)}
				onConfirm={() => void run()}
				title={pending ? copy[pending].title : ''}
				message={pending ? copy[pending].message : ''}
				confirmText={pending ? copy[pending].confirm : undefined}
				variant="danger"
			/>
		</>
	);
}
