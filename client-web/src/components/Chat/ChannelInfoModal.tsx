import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Users,
	Hash,
	Lock,
	Calendar,
	Copy,
	Check,
	SlidersHorizontal,
	Share2,
	Shield,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, ChannelInitialsAvatar } from '@/components/Avatar';
import { ModalShell } from '@/components/modal-shell';
import type { Channel } from '@/types/api';
import { isDirectMessage } from '@/utils/channel';
import { getFileUrl } from '@/api/client';
import { useAuthStore } from '@/store/auth.slice';
import { useChannelStore } from '@/store/channels.slice';
import { isAdmin } from '@/utils/role';
import { cn } from '@/lib/utils';

interface ChannelInfoModalProps {
	channel: Channel;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOpenSettings?: () => void;
}

interface InfoRowProps {
	icon: React.ReactNode;
	label: string;
	children: React.ReactNode;
}

/** One label/value line inside the channel info card. */
const InfoRow: React.FC<InfoRowProps> = ({ icon, label, children }) => (
	<div className="flex items-center justify-between py-0.5 text-sm">
		<div className="flex items-center gap-2.5 text-muted-foreground">
			<span className="shrink-0 text-primary">{icon}</span>
			<span className="font-medium">{label}</span>
		</div>
		<div className="font-medium text-foreground">{children}</div>
	</div>
);

/**
 * Read-only channel/DM summary (avatar, description, members, created date,
 * invite link). Admins get a shortcut to the settings dialog.
 */
export const ChannelInfoModal: React.FC<ChannelInfoModalProps> = ({
	channel,
	open,
	onOpenChange,
	onOpenSettings,
}) => {
	const { t } = useTranslation();
	const liveChannel = useChannelStore(
		(state) => state.channels.find((c) => c.id === channel.id) || channel,
	);
	const currentUserId = useAuthStore((state) => state.user?.id);
	const isDM = isDirectMessage(liveChannel);
	const otherMemberId = isDM
		? liveChannel.members?.find((m) => m !== currentUserId)
		: undefined;
	const dmAvatarId = otherMemberId
		? liveChannel.member_avatars?.[otherMemberId]
		: undefined;

	const [copied, setCopied] = useState(false);

	const canManage = isAdmin(liveChannel.user_role);

	const handleCopyInvite = () => {
		if (!liveChannel.invite_link) return;
		const fullUrl = `${window.location.origin}/join/${liveChannel.invite_link}`;
		navigator.clipboard.writeText(fullUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const formattedDate = liveChannel.created_at
		? new Date(liveChannel.created_at).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			})
		: t('channel.info.unknown');

	const memberCount = liveChannel.members?.length ?? 0;

	return (
		<ModalShell
			open={open}
			onOpenChange={onOpenChange}
			title={t('channel.info.title', { name: liveChannel.name })}
			size="lg"
			chromeless
		>
			{/* Banner: flat theme colour, no gradients */}
			<div className="h-28 w-full bg-primary sm:h-32" />

			<div className="flex min-w-0 flex-col gap-5 px-5 pb-6 sm:px-8 sm:pb-8">
				{/* Avatar & channel type badge */}
				<div className="relative z-20 -mt-14 flex items-end justify-between gap-3 sm:-mt-16">
					<div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-card bg-card sm:h-28 sm:w-28">
						{isDM && otherMemberId ? (
							<Avatar userId={otherMemberId} avatarId={dmAvatarId} size={112} />
						) : liveChannel.avatar_id ? (
							<img
								src={getFileUrl(liveChannel.avatar_id)}
								alt={liveChannel.name}
								className="h-full w-full object-cover"
								draggable={false}
								onError={(e) => {
									(e.target as HTMLElement).style.display = 'none';
								}}
							/>
						) : (
							<ChannelInitialsAvatar id={liveChannel.id} name={liveChannel.name} size={112} />
						)}
					</div>

					<Badge
						variant="outline"
						className={cn(
							'mb-2 shrink-0 gap-1.5 px-3 py-1.5',
							liveChannel.is_private
								? 'border-warning/40 bg-warning/15 text-warning'
								: 'border-success/40 bg-success/15 text-success',
						)}
					>
						{liveChannel.is_private ? (
							<>
								<Lock size={13} className="shrink-0" />
								<span>{t('channel.info.private')}</span>
							</>
						) : (
							<>
								<Hash size={13} className="shrink-0" />
								<span>{t('channel.info.public')}</span>
							</>
						)}
					</Badge>
				</div>

				{/* Name & description */}
				<div className="flex min-w-0 flex-col gap-1.5">
					<h2 className="truncate text-xl font-bold leading-tight text-foreground sm:text-2xl">
						{liveChannel.name}
					</h2>
					{liveChannel.description ? (
						<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
							{liveChannel.description}
						</p>
					) : (
						<p className="text-sm italic text-muted-foreground">
							{t('channel.info.no_description')}
						</p>
					)}
				</div>

				{/* Meta card */}
				<div className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted p-4 sm:p-5">
					<InfoRow icon={<Users size={16} />} label={t('channel.info.members')}>
						{memberCount}
					</InfoRow>

					<Separator />

					<InfoRow icon={<Calendar size={16} />} label={t('channel.info.created')}>
						{formattedDate}
					</InfoRow>

					{liveChannel.user_role && (
						<>
							<Separator />
							<InfoRow icon={<Shield size={16} />} label={t('channel.info.your_role')}>
								<Badge variant="secondary" className="uppercase tracking-wider">
									{liveChannel.user_role}
								</Badge>
							</InfoRow>
						</>
					)}

					{liveChannel.invite_link && (
						<>
							<Separator />
							<div className="flex w-full min-w-0 flex-col gap-2 pt-0.5">
								<div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
									<span className="flex items-center gap-1.5">
										<Share2 size={13} className="text-primary" />
										<span>{t('channel.info.invite_link')}</span>
									</span>
									<span className="text-[11px]">{t('channel.info.share_hint')}</span>
								</div>
								<div className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
									<span
										dir="ltr"
										className="min-w-0 flex-1 select-all truncate font-mono text-xs text-muted-foreground"
									>
										{window.location.origin}/join/{liveChannel.invite_link}
									</span>
									<Button
										type="button"
										size="sm"
										onClick={handleCopyInvite}
										className="h-7 shrink-0 gap-1.5 px-3 text-xs"
									>
										{copied ? (
											<>
												<Check size={13} />
												<span>{t('channel.info.copied')}</span>
											</>
										) : (
											<>
												<Copy size={13} />
												<span>{t('channel.info.copy')}</span>
											</>
										)}
									</Button>
								</div>
							</div>
						</>
					)}
				</div>

				{/* Admin actions */}
				{canManage && onOpenSettings && (
					<Button
						type="button"
						variant="secondary"
						onClick={() => {
							onOpenChange(false);
							onOpenSettings();
						}}
						className="h-11 w-full gap-2"
					>
						<SlidersHorizontal size={16} />
						<span>{t('channel.info.settings')}</span>
					</Button>
				)}
			</div>
		</ModalShell>
	);
};
