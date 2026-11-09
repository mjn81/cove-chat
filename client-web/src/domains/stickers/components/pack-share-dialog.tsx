import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, Circle, Loader2, Search, Send } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getChannelDisplayName, useAuthStore, useChannelStore } from '@/store/store';
import { isDirectMessage } from '@/utils/channel';
import { wsSendMessage } from '@/ws';
import { encodePackShare } from '../utils/pack-share';

interface PackShareDialogProps {
	/** Pack to share; null keeps the dialog closed. */
	packId: string | null;
	onOpenChange: (open: boolean) => void;
}

/**
 * Picks chats and sends them the "Add stickers" card for a pack (a text message carrying the share token, see
 * `pack-share.ts`). Modelled on the forward dialog.
 *
 * @param packId - The user pack to share.
 */
export function PackShareDialog({ packId, onOpenChange }: PackShareDialogProps) {
	const { t } = useTranslation();
	const { channels } = useChannelStore();
	const userId = useAuthStore((s) => s.user?.id ?? '');
	const [selected, setSelected] = useState<string[]>([]);
	const [search, setSearch] = useState('');
	const [sending, setSending] = useState(false);

	const filtered = useMemo(
		() =>
			channels
				.filter((c) => getChannelDisplayName(c, userId).toLowerCase().includes(search.toLowerCase()))
				.sort((a, b) => getChannelDisplayName(a, userId).localeCompare(getChannelDisplayName(b, userId))),
		[channels, search, userId],
	);

	const send = async () => {
		if (!packId) return;
		setSending(true);
		try {
			const text = encodePackShare(packId);
			for (const id of selected) await wsSendMessage(id, text, 'text');
			toast.success(t('stickers.share.sent', { count: selected.length }));
			setSelected([]);
			onOpenChange(false);
		} catch {
			toast.error(t('stickers.share.failed'));
		} finally {
			setSending(false);
		}
	};

	return (
		<ModalShell
			open={!!packId}
			onOpenChange={onOpenChange}
			title={t('stickers.share.title')}
			bodyClassName="p-0"
			footer={
				<div className="flex w-full items-center justify-between gap-2">
					<span className="text-sm font-medium text-muted-foreground">{t('chat.forward.selected', { count: selected.length })}</span>
					<div className="flex gap-2">
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="button" disabled={selected.length === 0 || sending} onClick={send}>
							{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="rtl:-scale-x-100" />}
							{t('stickers.share.send')}
						</Button>
					</div>
				</div>
			}
		>
			<div className="border-b border-border bg-muted p-4">
				<div className="relative">
					<Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
					<Input
						className="ps-10"
						placeholder={t('chat.forward.search_placeholder')}
						aria-label={t('chat.forward.search_placeholder')}
						autoComplete="off"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
			</div>
			<div className="max-h-[300px] space-y-1 overflow-y-auto p-2">
				{filtered.map((channel) => {
					const isSelected = selected.includes(channel.id);
					const isDM = isDirectMessage(channel);
					const otherId = isDM ? channel.members.find((m) => m !== userId) || channel.id : channel.id;
					return (
						<ListRow
							key={channel.id}
							selected={isSelected}
							onClick={() => setSelected((p) => (p.includes(channel.id) ? p.filter((i) => i !== channel.id) : [...p, channel.id]))}
							leading={<Avatar userId={otherId} avatarId={isDM ? channel.member_avatars?.[otherId] : undefined} size={36} />}
							title={getChannelDisplayName(channel, userId)}
							subtitle={isDM ? t('chat.forward.direct_message') : t('chat.forward.members', { count: channel.members.length })}
							trailing={
								isSelected ? <CheckCircle2 size={20} className="text-primary" /> : <Circle size={20} className="text-muted-foreground opacity-40" />
							}
						/>
					);
				})}
				{filtered.length === 0 && <EmptyState title={t('chat.forward.no_results')} />}
			</div>
		</ModalShell>
	);
}
