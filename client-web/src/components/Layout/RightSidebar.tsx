import { useState, Profiler, useMemo, memo } from 'react';
import { IconButton } from '@/components/icon-button';
import { statusDotClass } from '@/domains/users/utils/status';
import { logProfiler } from '@/utils/profiler';

import { Avatar } from '@/components/Avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, LogOut, UserMinus, Shield, ChevronLeft, ChevronRight, User } from 'lucide-react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { useChannelStore, useAuthStore, useAppStore } from '@/store/store';
import { apiLeaveChannel, apiUpdateMemberRole } from '@/api/client';
import { ConfirmModal } from '@/components/ConfirmModal';
import { UserProfileModal } from '@/components/UserProfileModal';
import { isDirectMessage } from '@/utils/channel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
	ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { useRef } from 'react';
import { ChannelRole, isAdmin, isOwner } from '@/utils/role';
import { useTranslation } from 'react-i18next';
import { BotBadge } from '@/domains/bots/components/bot-badge';

interface Member {
	id: string;
	username: string;
	domain: string;
	status: string;
	avatar_id?: string;
	role: number;
	/** Bot accounts get a BOT badge and are managed from the channel's Bots section, not kicked or promoted. */
	isBot?: boolean;
}

interface RightSidebarProps {
	isCollapsed?: boolean;
	onToggleCollapse?: () => void;
}

export default function RightSidebar({
	isCollapsed = false,
	onToggleCollapse,
}: RightSidebarProps) {
		const { t } = useTranslation();
	const activeChannel = useChannelStore((state) => state.activeChannel);
	const refreshChannels = useChannelStore((state) => state.refreshChannels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
	const user = useAuthStore((state) => state.user);
	const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
	const [showKickConfirm, setShowKickConfirm] = useState<Member | null>(null);
	const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);
	const isMobile = useMediaQuery('(max-width: 768px)');

	// Touch gesture support
	const touchStartX = useRef<number | null>(null);
	const handleTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.touches[0].clientX;
	};
	const handleTouchEnd = (e: React.TouchEvent) => {
		if (touchStartX.current === null) return;
		const touchEndX = e.changedTouches[0].clientX;
		const deltaX = touchEndX - touchStartX.current;
		// If swiped right more than 50px
		if (deltaX > 50 && isMobile) {
			setRightSidebarOpen(false);
		}
		touchStartX.current = null;
	};

	const members: Member[] = useMemo(() => {
		if (!activeChannel) return [];
		return activeChannel.members.map((id) => ({
			id,
			username: activeChannel.member_names?.[id] || id,
			domain: activeChannel.member_domains?.[id] || '',
			status: activeChannel.member_statuses?.[id] || 'offline',
			avatar_id: activeChannel.member_avatars?.[id],
			role: activeChannel.member_roles?.[id] ?? 0,
			isBot: activeChannel.member_bots?.[id] === true,
		}));
	}, [activeChannel]);

	// ... (rest of the logic)
	const owners = useMemo(
		() => members.filter((m) => isOwner(m.role) && m.status !== 'offline'),
		[members],
	);
	const admins = useMemo(
		() =>
			members.filter(
				(m) => m.role === ChannelRole.ADMIN && m.status !== 'offline',
			),
		[members],
	);
	const onlineMembers = useMemo(
		() =>
			members.filter(
				(m) => m.role === ChannelRole.MEMBER && m.status !== 'offline',
			),
		[members],
	);
	const offlineMembers = useMemo(
		() => members.filter((m) => m.status === 'offline'),
		[members],
	);

	const isDM = activeChannel ? isDirectMessage(activeChannel) : false;
	const myRole =
		activeChannel && user ? activeChannel.member_roles?.[user.id] || 0 : 0;

	const handleLeave = async () => {
		if (!user || !activeChannel) return;
		setLoading(true);
		try {
			await apiLeaveChannel(activeChannel.id, user.id);
			setActiveChannel(null);
			await refreshChannels();
		} catch (err) {
			console.error('Failed to leave channel:', err);
		} finally {
			setLoading(false);
		}
	};

	const handleKick = async () => {
		if (!showKickConfirm || !activeChannel) return;
		setLoading(true);
		try {
			await apiLeaveChannel(activeChannel.id, showKickConfirm.id);
			await refreshChannels();
			setShowKickConfirm(null);
		} catch (err) {
			console.error('Failed to kick member:', err);
		} finally {
			setLoading(false);
		}
	};

	const handleUpdateRole = async (targetUserId: string, newRole: number) => {
		if (!activeChannel) return;
		setLoading(true);
		try {
			await apiUpdateMemberRole(activeChannel.id, targetUserId, newRole);
			await refreshChannels();
		} catch (err) {
			console.error('Failed to update role:', err);
		} finally {
			setLoading(false);
		}
	};

	if (!activeChannel) {
		return <div className="h-full bg-popover"></div>;
	}

	return (
		<Profiler id="RightSidebar" onRender={logProfiler}>
			<div
				className="flex flex-col h-full bg-popover"
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
			>
				{/* Header - Styled to match ChatTopbar, adaptive to collapse */}
				<div
					className={`flex items-center h-12 border-b border-border shrink-0 bg-background transition-all ${isCollapsed ? 'justify-center w-full' : 'px-4 gap-3'}`}
				>
					<div
						className={`flex items-center gap-3 min-w-0 ${isCollapsed ? 'justify-center w-full' : 'flex-1'}`}
					>
						{isMobile ? (
							<button
								onClick={() => setRightSidebarOpen(false)}
								className="p-1 -ms-2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
							>
								<ChevronLeft size={26} />
							</button>
						) : isCollapsed && onToggleCollapse ? (
							<button
								type="button"
								onClick={onToggleCollapse}
								className="w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition"
								title={t('members.expand')}
							>
								<Users size={20} className="opacity-70" />
							</button>
						) : (
							<div className="w-8 h-8 flex items-center justify-center text-muted-foreground shrink-0">
								<Users size={24} className="opacity-70" />
							</div>
						)}
						{!isCollapsed && (
							<h2 className="text-[15px] font-bold text-foreground leading-tight truncate">
								{t('members.title')}
							</h2>
						)}
					</div>
					{!isMobile && !isCollapsed && onToggleCollapse && (
						<button
							type="button"
							onClick={onToggleCollapse}
							className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition"
							title={t('members.collapse')}
						>
							<ChevronRight size={16} />
						</button>
					)}
				</div>

				<ScrollArea className="flex-1">
					<div
						className={`flex flex-col ${isCollapsed ? 'pt-4 items-center' : 'pt-5 pb-4'}`}
					>
						<Section
							title={t('members.owner')}
							count={owners.length}
							list={owners}
							user={user}
							isDM={isDM}
							myRole={myRole}
							onUpdateRole={handleUpdateRole}
							onKick={setShowKickConfirm}
							onViewProfile={setSelectedProfileUserId}
							isCollapsed={isCollapsed}
						/>
						<Section
							title={t('members.admins')}
							count={admins.length}
							list={admins}
							user={user}
							isDM={isDM}
							myRole={myRole}
							onUpdateRole={handleUpdateRole}
							onKick={setShowKickConfirm}
							onViewProfile={setSelectedProfileUserId}
							isCollapsed={isCollapsed}
						/>
						<Section
							title={t('members.online')}
							count={onlineMembers.length}
							list={onlineMembers}
							user={user}
							isDM={isDM}
							myRole={myRole}
							onUpdateRole={handleUpdateRole}
							onKick={setShowKickConfirm}
							onViewProfile={setSelectedProfileUserId}
							isCollapsed={isCollapsed}
						/>
						<Section
							title={t('members.offline')}
							count={offlineMembers.length}
							list={offlineMembers}
							user={user}
							isDM={isDM}
							myRole={myRole}
							onUpdateRole={handleUpdateRole}
							onKick={setShowKickConfirm}
							onViewProfile={setSelectedProfileUserId}
							isCollapsed={isCollapsed}
						/>
					</div>
				</ScrollArea>

				{/* Leave Channel footer: same strip and destructive styling as the left sidebar's log-out. */}
				{!isDM && (
					<div
						className={`relative z-10 shrink-0 border-t border-border/50 bg-secondary ${
							isCollapsed ? 'flex items-center justify-center py-2.5' : 'flex h-[52px] items-center px-2'
						}`}
					>
						{isCollapsed ? (
							<TooltipProvider delayDuration={0}>
								<Tooltip>
									<TooltipTrigger asChild>
										<IconButton
											label={t('members.leave')}
											tone="destructive"
											disabled={loading}
											onClick={() => setShowLeaveConfirm(true)}
										>
											<LogOut className="h-4 w-4 pointer-events-none" />
										</IconButton>
									</TooltipTrigger>
									<TooltipContent side="left" className="font-bold text-destructive">
										{t('members.leave')}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						) : (
							<button
								type="button"
								disabled={loading}
								onClick={() => setShowLeaveConfirm(true)}
								className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-md px-2 text-[13px] font-bold text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50"
							>
								<LogOut className="pointer-events-none h-4 w-4 shrink-0" />
								<span className="truncate whitespace-nowrap">{t('members.leave')}</span>
							</button>
						)}
					</div>
				)}

				<ConfirmModal
					isOpen={showLeaveConfirm}
					onClose={() => setShowLeaveConfirm(false)}
					onConfirm={handleLeave}
					title={t('members.leave')}
					message={t('members.leave_confirm', { name: activeChannel.name })}
					confirmText={t('members.leave')}
					variant="danger"
				/>

				<ConfirmModal
					isOpen={!!showKickConfirm}
					onClose={() => setShowKickConfirm(null)}
					onConfirm={handleKick}
					title={t('members.kick')}
					message={t('members.kick_confirm', { name: showKickConfirm?.username })}
					confirmText={t('members.kick')}
					variant="danger"
				/>

				{selectedProfileUserId && (
					<UserProfileModal
						userId={selectedProfileUserId}
						open={!!selectedProfileUserId}
						onOpenChange={(open) => !open && setSelectedProfileUserId(null)}
					/>
				)}
			</div>
		</Profiler>
	);
}

(RightSidebar as any).whyDidYouRender = true;

interface SectionProps {
	title: string;
	count: number;
	list: Member[];
	user: any;
	isDM: boolean;
	myRole: number;
	onUpdateRole: (id: string, role: number) => void;
	onKick: (member: Member) => void;
	onViewProfile: (userId: string) => void;
	isCollapsed: boolean;
}

const Section = memo(
	({ title, count, list, isCollapsed, ...props }: SectionProps) => {
		if (list.length === 0) return null;
		return (
			<div
				className={`mb-5 ${isCollapsed ? 'flex flex-col items-center w-full' : ''}`}
			>
				{!isCollapsed && (
					<h3 className="text-[11px] font-bold text-muted-foreground/60 px-4 mb-1 tracking-wider uppercase select-none truncate">
						{title} — {count}
					</h3>
				)}
				<div
					className={`flex flex-col gap-0.5 ${isCollapsed ? 'w-full items-center' : ''}`}
				>
					{list.map((m) => (
						<MemberRow
							key={m.id}
							member={m}
							isCollapsed={isCollapsed}
							{...props}
						/>
					))}
				</div>
			</div>
		);
	},
);

Section.displayName = 'Section';

interface MemberRowProps {
	member: Member;
	user: any;
	isDM: boolean;
	myRole: number;
	onUpdateRole: (id: string, role: number) => void;
	onKick: (member: Member) => void;
	onViewProfile: (userId: string) => void;
	isCollapsed: boolean;
}

const MemberRow = memo(
	({
		member,
		user,
		isDM,
		myRole,
		onUpdateRole,
		onKick,
		onViewProfile,
		isCollapsed,
	}: MemberRowProps) => {
		const { t } = useTranslation();
		const isMe = member.id === user?.id;
		const canKick = !isDM && isAdmin(myRole) && myRole > member.role && !isMe && !member.isBot;
		const canPromote =
			!isDM && isOwner(myRole) && member.role === ChannelRole.MEMBER && !isMe && !member.isBot;
		const canDemote =
			!isDM && isOwner(myRole) && member.role === ChannelRole.ADMIN && !isMe;

		const roleColor = isOwner(member.role)
			? 'text-warning'
			: member.role === ChannelRole.ADMIN
				? 'text-primary'
				: 'text-foreground';

		return (
			<ContextMenu>
				<ContextMenuTrigger>
					<TooltipProvider delayDuration={0}>
						<Tooltip>
							<TooltipTrigger asChild>
								<div
									onClick={() => onViewProfile(member.id)}
									className={`flex items-center rounded-md cursor-pointer transition-all hover:bg-accent/50 active:bg-accent group relative ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-2 py-1.5 mx-2'}`}
								>
									<div className="relative shrink-0">
										<Avatar
											userId={member.id}
											avatarId={member.avatar_id}
											size={32}
											className="shrink-0"
										/>
										<div
											className={`absolute -bottom-0.5 -end-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-secondary group-hover:border-accent/50 transition-colors ${statusDotClass(member.status)}`}
										/>
									</div>
									{!isCollapsed && (
										<div className="flex flex-col flex-1 min-w-0">
											<div className="flex items-center gap-1.5 min-w-0">
												<span
													className={`text-[14px] font-medium leading-tight truncate ${member.status !== 'offline' ? roleColor : 'text-muted-foreground/50'}`}
												>
													{member.username}
												</span>
												{member.isBot && <BotBadge />}
											</div>
										</div>
									)}
								</div>
							</TooltipTrigger>
							{isCollapsed && (
								<TooltipContent side="left" className="font-bold">
									{member.username}
								</TooltipContent>
							)}
						</Tooltip>
					</TooltipProvider>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-48">
					<ContextMenuItem
						className="gap-2 cursor-pointer"
						onClick={() => onViewProfile(member.id)}
					>
						<User size={16} />
						{t('members.view_profile')}
					</ContextMenuItem>
					{(canKick || canPromote || canDemote) && (
						<>
							<ContextMenuSeparator />
							{canPromote && (
								<ContextMenuItem
									className="gap-2 cursor-pointer"
									onClick={() => onUpdateRole(member.id, ChannelRole.ADMIN)}
								>
									<Shield size={16} className="text-primary" />
									{t('members.promote')}
								</ContextMenuItem>
							)}
							{canDemote && (
								<ContextMenuItem
									className="gap-2 cursor-pointer"
									onClick={() => onUpdateRole(member.id, ChannelRole.MEMBER)}
								>
									<UserMinus size={16} className="text-muted-foreground" />
									{t('members.demote')}
								</ContextMenuItem>
							)}
							{canKick && (
								<>
									{(canPromote || canDemote) && <ContextMenuSeparator />}
									<ContextMenuItem
										className="text-destructive focus:text-destructive focus:bg-destructive/10 font-bold gap-2 cursor-pointer"
										onClick={() => onKick(member)}
									>
										<UserMinus size={16} />
										{t('members.kick')}
									</ContextMenuItem>
								</>
							)}
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
		);
	},
);

MemberRow.displayName = 'MemberRow';
