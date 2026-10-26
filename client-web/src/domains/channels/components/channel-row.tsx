import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Trash2, User, Volume2 } from 'lucide-react';

import { Avatar, ChannelInitialsAvatar } from '@/components/Avatar';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusDot } from '@/domains/users/components/status-dot';
import { normalizeStatus } from '@/domains/users/utils/status';
import { getFileUrl } from '@/api/client';
import { useVoiceStore } from '@/store/voiceStore';
import { getChannelDisplayName } from '@/store/store';
import { cn } from '@/lib/utils';
import type { AuthUser, Channel } from '@/types/api';

interface ChannelRowProps {
	ch: Channel;
	isGroup: boolean;
	user: AuthUser | null;
	isActive: boolean;
	isBlocked?: boolean;
	/** Icon-only rail mode: avatar with tooltip instead of text. */
	isCollapsed?: boolean;
	onSelect: (ch: Channel) => void;
	onDeleteDM: (ch: Channel) => void;
	onViewProfile: (userId: string) => void;
}

interface RowBadgesProps {
	hasVoice: boolean;
	isCollapsed?: boolean;
	unreadCount: number;
}

/** Voice-active and (collapsed-only) unread badges pinned to an avatar corner. */
const RowBadges = ({ hasVoice, isCollapsed, unreadCount }: RowBadgesProps) => (
	<>
		{hasVoice && (
			<div
				className={cn(
					'absolute -top-1 z-10 rounded-full border-2 border-secondary bg-success p-1 text-success-foreground shadow-md animate-in zoom-in duration-200',
					isCollapsed ? '-start-1' : '-end-1',
				)}
			>
				<Volume2 size={10} fill="currentColor" className="animate-pulse" />
			</div>
		)}
		{isCollapsed && unreadCount > 0 && (
			<div className="absolute -top-1 -end-1 z-10 flex h-[16px] min-w-[16px] items-center justify-center rounded-full border-2 border-secondary bg-primary px-1 text-[10px] font-bold leading-none tabular-nums text-primary-foreground shadow-sm">
				{unreadCount > 9 ? '9+' : unreadCount}
			</div>
		)}
	</>
);

/**
 * One conversation in the sidebar list: avatar (with presence for DMs),
 * name, preview/voice subtitle, unread badge and a context menu.
 */
export const ChannelRow = memo(
	({
		ch,
		isGroup,
		user,
		isActive,
		isBlocked,
		isCollapsed,
		onSelect,
		onDeleteDM,
		onViewProfile,
	}: ChannelRowProps) => {
		const { t } = useTranslation();
		const display = getChannelDisplayName(ch, user?.id ?? '');
		const voiceCount = useVoiceStore((state) => state.participants[ch.id]?.length ?? 0);
		const hasVoice = voiceCount > 0;
		const otherMemberId = ch.members.find((m) => m !== user?.id) || ch.id;
		const otherStatus = ch.member_statuses?.[otherMemberId];
		const unreadCount = !isActive ? (ch.unread_count ?? 0) : 0;

		const subtitle = hasVoice
			? t('sidebar.in_voice_call', { count: voiceCount })
			: ch.last_message_preview ||
				(isGroup
					? ch.description || t('sidebar.members_count', { count: ch.members?.length ?? 0 })
					: t(`status.${normalizeStatus(otherStatus)}`));

		const avatarNode = (
			<div className="pointer-events-none relative shrink-0">
				{isGroup ? (
					ch.avatar_id ? (
						<div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border/40 bg-secondary">
							<img
								src={getFileUrl(ch.avatar_id)}
								alt={ch.name}
								className="h-full w-full object-cover"
								draggable={false}
							/>
						</div>
					) : (
						<ChannelInitialsAvatar id={ch.id} name={ch.name} size={40} />
					)
				) : (
					<>
						<Avatar
							userId={otherMemberId}
							avatarId={ch.member_avatars?.[otherMemberId]}
							size={40}
						/>
						<StatusDot
							status={otherStatus}
							className="absolute -bottom-0.5 -end-0.5 z-10 border-2 border-secondary"
						/>
					</>
				)}
				<RowBadges hasVoice={hasVoice} isCollapsed={isCollapsed} unreadCount={unreadCount} />
			</div>
		);

		const rowClassName = cn(
			'flex w-full cursor-pointer select-none items-center rounded-md transition-colors duration-150',
			isCollapsed ? 'justify-center p-1.5' : 'gap-3 px-2 py-2',
			isActive
				? 'bg-accent text-foreground'
				: isBlocked
					? 'text-muted-foreground/60 opacity-60 hover:bg-accent/40 hover:text-foreground'
					: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
		);

		const row = isCollapsed ? (
			<TooltipProvider delayDuration={0}>
				<Tooltip>
					<TooltipTrigger asChild>
						<div onClick={() => onSelect(ch)} className={rowClassName}>
							{avatarNode}
						</div>
					</TooltipTrigger>
					<TooltipContent side="right" className="flex items-center gap-1.5 font-bold">
						<span>{display}</span>
						{unreadCount > 0 && (
							<span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary-foreground">
								{unreadCount}
							</span>
						)}
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		) : (
			<div onClick={() => onSelect(ch)} className={rowClassName}>
				{avatarNode}
				<div className="pointer-events-none flex min-w-0 flex-1 select-none flex-col justify-center">
					<div className="flex items-center gap-2">
						<span className="truncate text-[14px] font-medium leading-tight">{display}</span>
						{isBlocked && (
							<span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] font-semibold text-destructive">
								{t('sidebar.blocked')}
							</span>
						)}
					</div>
					<span
						className={cn(
							'mt-0.5 truncate text-[11px] leading-tight',
							hasVoice ? 'font-medium text-success' : 'text-muted-foreground/80',
						)}
					>
						{subtitle}
					</span>
				</div>

				{unreadCount > 0 && (
					<div className="pointer-events-none flex h-[19px] min-w-[19px] shrink-0 select-none items-center justify-center rounded-[5px] bg-primary px-1 text-[11.5px] font-bold leading-none tabular-nums text-primary-foreground shadow-sm">
						<span className="flex -translate-y-[0.5px] items-center justify-center leading-none">
							{unreadCount}
						</span>
					</div>
				)}
			</div>
		);

		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
				<ContextMenuContent className="w-48 border-border bg-popover text-foreground">
					<ContextMenuItem onClick={() => onSelect(ch)} className="cursor-pointer gap-2">
						<MessageSquare className="h-4 w-4" />
						<span>{isGroup ? t('sidebar.open_channel') : t('sidebar.open_chat')}</span>
					</ContextMenuItem>
					{!isGroup && (
						<>
							<ContextMenuItem
								onClick={() => onViewProfile(otherMemberId)}
								className="cursor-pointer gap-2"
							>
								<User className="h-4 w-4" />
								<span>{t('sidebar.view_profile')}</span>
							</ContextMenuItem>
							<ContextMenuSeparator className="bg-border" />
							<ContextMenuItem
								onClick={() => onDeleteDM(ch)}
								className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
							>
								<Trash2 className="h-4 w-4" />
								<span>{t('sidebar.delete_chat')}</span>
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
		);
	},
);

ChannelRow.displayName = 'ChannelRow';
