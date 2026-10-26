import React, { useState } from 'react';
import { findDirectChannel } from '@/domains/channels/utils/direct-message';
import { useTranslation } from 'react-i18next';
import { Search, Send, Check, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { EmptyState } from '@/components/empty-state';
import { Avatar as MinidenticonAvatar } from '@/components/Avatar';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/store';
import { useChannelStore } from '@/store/channels.slice';
import { wsSendMessage } from '@/ws';
import { logger } from '@/utils/logger';

interface FriendPickerModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	channelId?: string;
	channelName?: string;
	inviteLink?: string;
}

/**
 * Lets the user pick friends and DM each of them a channel invite link.
 *
 * @param inviteLink - Channel invite code; the picker does nothing without it.
 * @param channelName - Shown in the invite text sent to each friend.
 */
export const FriendPickerModal: React.FC<FriendPickerModalProps> = ({
	open,
	onOpenChange,
	channelName,
	inviteLink,
}) => {
	const { t } = useTranslation();
	const relationships = useAuthStore((state) => state.relationships);
	const channels = useChannelStore((state) => state.channels);
	const createChannel = useChannelStore((state) => state.createChannel);

	const [search, setSearch] = useState('');
	const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [sentSuccess, setSentSuccess] = useState(false);

	const friends = relationships.filter((r) => r.type === 'friend');
	const filteredFriends = friends.filter((f) =>
		f.user?.username.toLowerCase().includes(search.toLowerCase()),
	);

	const toggleSelect = (uid: string) => {
		setSelectedUserIds((prev) =>
			prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
		);
	};

	const handleSendInviteLinks = async () => {
		if (selectedUserIds.length === 0 || !inviteLink) return;

		setIsSending(true);
		try {
			const linkUrl = `${window.location.origin}/join/${inviteLink}`;
			const inviteText = t('channel.invite.message', {
				name: channelName || t('channel.invite.default_channel'),
				link: linkUrl,
			});

			for (const friendId of selectedUserIds) {
				const dmChannel =
					findDirectChannel(channels, friendId) ?? (await createChannel('', [friendId], true));
				if (dmChannel) {
					await wsSendMessage(dmChannel.id, inviteText, 'text');
				}
			}

			setSentSuccess(true);
			setTimeout(() => {
				setSentSuccess(false);
				setSelectedUserIds([]);
				onOpenChange(false);
			}, 1500);
		} catch (err) {
			logger.error('Failed to send invite links', { error: String(err) });
		} finally {
			setIsSending(false);
		}
	};

	return (
		<ModalShell
			open={open}
			onOpenChange={onOpenChange}
			title={t('channel.invite.title')}
			footer={
				<div className="flex w-full items-center justify-between gap-2">
					<span className="text-xs text-muted-foreground">
						{t('channel.invite.selected_count', { count: selectedUserIds.length })}
					</span>
					<div className="flex items-center gap-2">
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							type="button"
							disabled={selectedUserIds.length === 0 || isSending || sentSuccess}
							onClick={handleSendInviteLinks}
						>
							{sentSuccess ? (
								<>
									<Check size={14} />
									<span>{t('channel.invite.sent')}</span>
								</>
							) : isSending ? (
								<>
									<Loader2 size={14} className="animate-spin" />
									<span>{t('channel.invite.sending')}</span>
								</>
							) : (
								<>
									<Send size={14} className="rtl:-scale-x-100" />
									<span>{t('channel.invite.send')}</span>
								</>
							)}
						</Button>
					</div>
				</div>
			}
		>
			<div className="flex flex-col gap-3">
				<div className="relative">
					<Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t('channel.invite.search_placeholder')}
						aria-label={t('channel.invite.search_placeholder')}
						autoComplete="off"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						className="ps-9"
					/>
				</div>

				<div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
					{filteredFriends.length === 0 ? (
						<EmptyState
							title={search ? t('channel.invite.no_match') : t('channel.invite.no_friends')}
						/>
					) : (
						filteredFriends.map((f) => {
							const isSelected = selectedUserIds.includes(f.to_user_id);
							return (
								<ListRow
									key={f.to_user_id}
									selected={isSelected}
									onClick={() => toggleSelect(f.to_user_id)}
									leading={
										<MinidenticonAvatar
											userId={f.to_user_id}
											avatarId={f.user?.avatar_id}
											size={36}
										/>
									}
									title={f.user?.username || t('channel.invite.friend_fallback')}
									subtitle={`~${f.user?.domain || 'localhost'}`}
									trailing={
										<span
											aria-hidden="true"
											className={cn(
												'flex h-5 w-5 items-center justify-center rounded border',
												isSelected
													? 'border-primary bg-primary text-primary-foreground'
													: 'border-input',
											)}
										>
											{isSelected && <Check size={12} />}
										</span>
									}
								/>
							);
						})
					)}
				</div>
			</div>
		</ModalShell>
	);
};

export default FriendPickerModal;
