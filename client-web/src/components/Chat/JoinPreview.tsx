import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, Globe, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChannelAvatar } from '@/components/Avatar';
import { useGetInvitePreview, useJoinInvite } from '@/domains/channels/hooks/use-invite';
import { useChannelStore } from '@/store/store';
import type { Channel } from '@/types/api';

interface JoinPreviewProps {
	inviteCode: string;
	/** Called after joining or opening, with the channel that is now in the user's list (if found). */
	onDone?: (channel: Channel | undefined) => void;
}

/**
 * Invite card: shows the channel behind an invite code (name, avatar, member count) and lets the
 * user join, or open it when they already belong. Backend error messages are shown as-is.
 *
 * @param inviteCode - The code from a `/join/<code>` link.
 * @param onDone - Notified once the user has joined or chosen to open the channel.
 */
export const JoinPreview: React.FC<JoinPreviewProps> = ({ inviteCode, onDone }) => {
	const { t } = useTranslation();
	const refreshChannels = useChannelStore((state) => state.refreshChannels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
	const preview = useGetInvitePreview(inviteCode);
	const join = useJoinInvite();

	const openChannel = async (id: string) => {
		await refreshChannels();
		const channel = useChannelStore.getState().channels.find((c) => c.id === id);
		if (channel) setActiveChannel(channel);
		onDone?.(channel);
	};

	const handleJoin = async () => {
		try {
			const joined = await join.mutateAsync(inviteCode);
			await openChannel(joined.id);
		} catch {
			// Surfaced below through join.error.
		}
	};

	if (preview.isLoading) {
		return (
			<Card className="mt-2 flex max-w-sm items-center justify-center bg-secondary/30 p-4">
				<Loader2 size={18} className="animate-spin text-muted-foreground" />
			</Card>
		);
	}

	if (preview.isError || !preview.data) {
		return (
			<Card className="mt-2 max-w-sm border-destructive/40 bg-secondary/30 p-4">
				<span className="text-xs font-medium text-destructive">
					{preview.error?.message || t('channel.invite.preview.load_failed')}
				</span>
			</Card>
		);
	}

	const data = preview.data;
	return (
		<Card className="mt-2 flex max-w-sm flex-col gap-3 border-primary/20 bg-secondary/30 p-4">
			<div className="flex items-start gap-3">
				<ChannelAvatar id={data.id} name={data.name} avatarId={data.avatar_id} size={40} />
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-sm font-bold text-foreground">{data.name}</span>
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="flex items-center gap-1">
							<Users size={12} />
							{t('channel.invite.preview.members', { count: data.member_count })}
						</span>
						<span className="flex items-center gap-1">
							{data.is_private ? <Lock size={12} /> : <Globe size={12} />}
							{data.is_private
								? t('channel.invite.preview.private')
								: t('channel.invite.preview.public')}
						</span>
					</span>
				</div>
			</div>

			{data.description && (
				<p className="line-clamp-3 text-xs text-muted-foreground">{data.description}</p>
			)}

			{join.error && (
				<span className="px-1 text-[11px] font-medium text-destructive">
					{join.error.message || t('channel.invite.preview.join_failed')}
				</span>
			)}

			{data.already_member ? (
				<Button size="sm" variant="secondary" className="w-full font-bold" onClick={() => openChannel(data.id)}>
					{t('channel.invite.preview.open')}
				</Button>
			) : (
				<Button size="sm" className="w-full gap-2 font-bold" onClick={handleJoin} disabled={join.isPending}>
					{join.isPending ? t('channel.invite.preview.joining') : t('channel.invite.preview.join')}
				</Button>
			)}
		</Card>
	);
};
