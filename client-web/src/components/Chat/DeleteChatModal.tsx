import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, User, Users, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/Avatar';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { apiDeleteChannel } from '@/api/client';
import { useChannelStore, useAuthStore, getChannelDisplayName } from '@/store/store';
import { cn } from '@/lib/utils';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/api';

interface DeleteChatModalProps {
	channel: Channel;
	isOpen: boolean;
	onClose: () => void;
	onDeleted?: () => void;
}

interface DeleteOptionProps {
	icon: React.ReactNode;
	title: string;
	description: string;
	selected: boolean;
	destructive?: boolean;
	disabled: boolean;
	onSelect: () => void;
}

/** One radio-style card in the delete dialog ("for me only" / "for both"). */
const DeleteOption: React.FC<DeleteOptionProps> = ({
	icon,
	title,
	description,
	selected,
	destructive,
	disabled,
	onSelect,
}) => (
	<button
		type="button"
		role="radio"
		aria-checked={selected}
		disabled={disabled}
		onClick={onSelect}
		className={cn(
			'flex w-full items-start gap-3 rounded-lg border p-3.5 text-start transition-colors',
			selected
				? destructive
					? 'border-destructive bg-destructive/5'
					: 'border-primary bg-primary/5'
				: 'border-border hover:bg-accent',
		)}
	>
		<span
			className={cn(
				'mt-0.5 shrink-0 rounded-md p-2',
				selected
					? destructive
						? 'bg-destructive/15 text-destructive'
						: 'bg-primary/15 text-primary'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{icon}
		</span>
		<span className="min-w-0 flex-1">
			<span className="block text-sm font-semibold text-foreground">{title}</span>
			<span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
				{description}
			</span>
		</span>
	</button>
);

/**
 * Asks how to delete a direct-message chat: only for the current user, or
 * for both participants (which wipes the conversation server-side).
 */
export const DeleteChatModal: React.FC<DeleteChatModalProps> = ({
	channel,
	isOpen,
	onClose,
	onDeleted,
}) => {
	const { t } = useTranslation();
	const [deleteForBoth, setDeleteForBoth] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const currentUser = useAuthStore((state) => state.user);
	const removeChannel = useChannelStore((state) => state.removeChannel);
	const activeChannel = useChannelStore((state) => state.activeChannel);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const otherMemberId =
		channel.members.find((m) => m !== currentUser?.id) ||
		channel.members[0] ||
		channel.id;
	const displayName = getChannelDisplayName(channel, currentUser?.id ?? '');

	const handleDelete = async () => {
		setIsDeleting(true);
		try {
			await apiDeleteChannel(channel.id, deleteForBoth);
			removeChannel(channel.id);
			if (activeChannel?.id === channel.id) {
				setActiveChannel(null);
			}
			onDeleted?.();
			onClose();
		} catch (err) {
			logger.error('Failed to delete channel', { error: String(err) });
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<ModalShell
			open={isOpen}
			onOpenChange={(open) => !open && !isDeleting && onClose()}
			title={t('chat.delete.title')}
			footer={
				<>
					<Button type="button" variant="ghost" disabled={isDeleting} onClick={onClose}>
						{t('common.cancel')}
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={isDeleting}
						onClick={handleDelete}
					>
						{isDeleting ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								<span>{t('chat.delete.deleting')}</span>
							</>
						) : (
							<>
								<Trash2 size={16} />
								<span>
									{deleteForBoth ? t('chat.delete.confirm_both') : t('chat.delete.confirm_me')}
								</span>
							</>
						)}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<ListRow
					className="rounded-lg border border-border bg-muted p-3"
					leading={
						<Avatar
							userId={otherMemberId}
							avatarId={channel.member_avatars?.[otherMemberId]}
							size={40}
						/>
					}
					title={displayName}
					subtitle={t('chat.delete.direct_message')}
				/>

				<p className="text-sm leading-relaxed text-muted-foreground">
					{t('chat.delete.prompt', { name: displayName })}
				</p>

				<div role="radiogroup" className="space-y-2.5">
					<DeleteOption
						icon={<User size={18} />}
						title={t('chat.delete.me_only_title')}
						description={t('chat.delete.me_only_desc', { name: displayName })}
						selected={!deleteForBoth}
						disabled={isDeleting}
						onSelect={() => setDeleteForBoth(false)}
					/>
					<DeleteOption
						icon={<Users size={18} />}
						title={t('chat.delete.both_title', { name: displayName })}
						description={t('chat.delete.both_desc')}
						selected={deleteForBoth}
						destructive
						disabled={isDeleting}
						onSelect={() => setDeleteForBoth(true)}
					/>
				</div>
			</div>
		</ModalShell>
	);
};
