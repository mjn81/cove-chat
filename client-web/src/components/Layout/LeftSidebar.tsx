import { useEffect, useState, memo, useCallback, useMemo } from 'react';
import { Avatar, ChannelInitialsAvatar } from '@/components/Avatar';
import { NavStrip, type SidebarTab } from './NavStrip';
import NewChannelModal from '@/components/NewChannelModal';
import SettingsModal from '@/components/SettingsModal';
import { useExploreChannels } from '@/hooks/useChannels';
import { apiJoinChannel } from '@/api/client';
import { Settings, LogOut, Plus, Hash, Search, Volume2, Trash2, MessageSquare, User } from 'lucide-react';
import { useVoiceStore } from '@/store/voiceStore';
import { ConversationSearchDialog } from './ConversationSearchDialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { DeleteChatModal } from '@/components/Chat/DeleteChatModal';
import { UserProfileModal } from '@/components/UserProfileModal';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	useAppStore,
	useAuthStore,
	useChannelStore,
	getChannelDisplayName,
} from '@/store/store';
import type { AuthUser, Channel } from '@/types/api';
import { isDirectMessage } from '@/utils/channel';
import { getFileUrl } from '@/api/client';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isMac } from '@/utils/wails';

const RenderChannel = memo(
	({
		ch,
		isGroup,
		user,
		isActive,
		isBlocked,
		onSelect,
		onDeleteDM,
		onViewProfile,
	}: {
		ch: Channel;
		isGroup: boolean;
		user: AuthUser | null;
		isActive: boolean;
		isBlocked?: boolean;
		onSelect: (ch: Channel) => void;
		onDeleteDM: (ch: Channel) => void;
		onViewProfile: (userId: string) => void;
	}) => {
		const display = getChannelDisplayName(ch, user?.id ?? '');
		const hasVoice = useVoiceStore(
			(state) => (state.participants[ch.id]?.length ?? 0) > 0,
		);
		const otherMemberId = ch.members.find((m) => m !== user?.id) || ch.id;

		const subtitle =
			ch.last_message_preview ||
			(isGroup
				? ch.description || `${ch.members?.length ?? 0} members`
				: (() => {
						const st = ch.member_statuses?.[otherMemberId];
						return st ? st.charAt(0).toUpperCase() + st.slice(1) : 'Offline';
					})());

		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						onClick={() => onSelect(ch)}
						className={`w-full flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer select-none transition ${
							isActive
								? 'bg-accent text-foreground'
								: isBlocked
									? 'text-muted-foreground/60 opacity-60 hover:bg-accent/40 hover:text-foreground'
									: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
						}`}
					>
				{isGroup ? (
					<div className="relative shrink-0 pointer-events-none">
						{ch.avatar_id ? (
							<div className="w-10 h-10 rounded-full overflow-hidden bg-secondary border border-border/40 shrink-0">
								<img
									src={getFileUrl(ch.avatar_id)}
									alt={ch.name}
									className="w-full h-full object-cover"
									draggable={false}
								/>
							</div>
						) : (
							<ChannelInitialsAvatar id={ch.id} name={ch.name} size={40} />
						)}
						{hasVoice && (
							<div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full p-0.5 shadow-sm border border-secondary z-10 animate-in zoom-in duration-300">
								<Volume2 size={10} fill="currentColor" />
							</div>
						)}
					</div>
				) : (
					<div className="relative shrink-0 pointer-events-none">
						<Avatar
							userId={otherMemberId}
							avatarId={ch.member_avatars?.[otherMemberId]}
							size={40}
						/>
						<div
							className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2px] border-secondary z-10 ${
								ch.member_statuses?.[otherMemberId] === 'online'
									? 'bg-green-500'
									: ch.member_statuses?.[otherMemberId] === 'away'
										? 'bg-yellow-500'
										: ch.member_statuses?.[otherMemberId] === 'dnd'
											? 'bg-red-500'
											: 'bg-gray-500'
							}`}
						/>
						{hasVoice && (
							<div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full p-0.5 shadow-sm border border-secondary z-10 animate-in zoom-in duration-300">
								<Volume2 size={10} fill="currentColor" />
							</div>
						)}
					</div>
				)}
				<div className="min-w-0 flex-1 flex flex-col justify-center pointer-events-none select-none">
					<div className="flex items-center gap-2">
						<span className="truncate text-[14px] font-medium leading-tight pointer-events-none select-none">
							{display}
						</span>
						{isBlocked && (
							<span className="text-[10px] font-semibold text-destructive bg-destructive/10 px-1 py-0.2 rounded shrink-0">
								Blocked
							</span>
						)}
					</div>
					<span className="truncate text-[11px] text-muted-foreground/80 leading-tight mt-0.5">
						{subtitle}
					</span>
				</div>

				{!isActive && (ch.unread_count ?? 0) > 0 && (
					<div className="flex items-center justify-center min-w-[19px] h-[19px] px-1 bg-[#e05638] rounded-[5px] text-[11.5px] font-bold text-white shadow-sm shrink-0 pointer-events-none select-none leading-none tabular-nums">
						<span className="leading-none flex items-center justify-center -translate-y-[0.5px]">
							{ch.unread_count}
						</span>
					</div>
				)}
			</div>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-48 bg-popover border-border text-foreground">
					<ContextMenuItem
						onClick={() => onSelect(ch)}
						className="gap-2 cursor-pointer"
					>
						<MessageSquare className="w-4 h-4" />
						<span>{isGroup ? 'Open Channel' : 'Open Chat'}</span>
					</ContextMenuItem>
					{!isGroup && (
						<ContextMenuItem
							onClick={() => onViewProfile(otherMemberId)}
							className="gap-2 cursor-pointer"
						>
							<User className="w-4 h-4" />
							<span>View Profile</span>
						</ContextMenuItem>
					)}
					{!isGroup && <ContextMenuSeparator className="bg-border" />}
					{!isGroup && (
						<ContextMenuItem
							onClick={() => onDeleteDM(ch)}
							className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
						>
							<Trash2 className="w-4 h-4" />
							<span>Delete Chat</span>
						</ContextMenuItem>
					)}
				</ContextMenuContent>
			</ContextMenu>
		);
	},
);

RenderChannel.displayName = 'RenderChannel';

export default function LeftSidebar() {
	const user = useAuthStore((state) => state.user);
	const logout = useAuthStore((state) => state.logout);
	const relationships = useAuthStore((state) => state.relationships);
	const channels = useChannelStore((state) => state.channels);
	const isLoading = useChannelStore((state) => state.isChannelsLoading);
	const activeChannelId = useChannelStore((state) => state.activeChannel?.id);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
	const appVersion = useAppStore((state) => state.appVersion);
	const fetchVersion = useAppStore((state) => state.fetchVersion);
	const wsState = useAppStore((state) => state.wsState);
	const handleSelectChannel = useCallback(
		(ch: Channel) => {
			setActiveChannel(ch);
		},
		[setActiveChannel],
	);
	const [activeTab, setActiveTab] = useState<SidebarTab>('all');
	const [search, setSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [isJoining, setIsJoining] = useState<string | null>(null);

	const [showNewChannel, setShowNew] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [showSearchDialog, setShowSearchDialog] = useState(false);
	const [deleteDmTarget, setDeleteDmTarget] = useState<Channel | null>(null);
	const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null);
	const [modalTab, setModalTab] = useState<'dm' | 'channel'>('dm');
	const isMobile = useMediaQuery('(max-width: 768px)');

	const handleDeleteDM = useCallback((ch: Channel) => {
		setDeleteDmTarget(ch);
	}, []);

	const handleViewProfile = useCallback((userId: string) => {
		setSelectedProfileUserId(userId);
	}, []);

	useEffect(() => {
		fetchVersion();
	}, [fetchVersion]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				setShowSearchDialog((prev) => !prev);
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []);

	useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedSearch(search.trim());
		}, 300);
		return () => clearTimeout(handler);
	}, [search]);

	const { data: exploreChannels = [], isFetching: isExploring } =
		useExploreChannels(debouncedSearch);

	const handleJoinChannel = async (link: string, id: string) => {
		if (isJoining) return;
		try {
			setIsJoining(id);
			await apiJoinChannel(link);
			await useChannelStore.getState().refreshChannels();
			const active = useChannelStore
				.getState()
				.channels.find((c) => c.id === id);
			if (active) useChannelStore.getState().setActiveChannel(active);
			setSearch('');
		} catch (error) {
			console.error(error);
		} finally {
			setIsJoining(null);
		}
	};

	const filtered = useMemo(() => {
		return channels.filter((ch) => {
			const display = getChannelDisplayName(ch, user?.id ?? '');
			return display.toLowerCase().includes(search.toLowerCase());
		});
	}, [channels, user?.id, search]);

	const byRecency = (a: Channel, b: Channel) => {
		const ta = a.last_message_at || a.created_at || '';
		const tb = b.last_message_at || b.created_at || '';
		return tb.localeCompare(ta);
	};

	const visibleChannels = useMemo(() => {
		if (activeTab === 'channels') {
			return [...filtered.filter((ch) => !isDirectMessage(ch))].sort(byRecency);
		}
		if (activeTab === 'dms') {
			return [...filtered.filter((ch) => isDirectMessage(ch))].sort(byRecency);
		}
		return [...filtered].sort(byRecency);
	}, [filtered, activeTab]);

	return (
		<div className="flex flex-row h-full w-full overflow-hidden">
			{!isMobile && (
				<NavStrip
					activeTab={activeTab}
					onChange={setActiveTab}
					orientation="vertical"
				/>
			)}

			<div className="flex flex-col h-full bg-secondary flex-1 min-w-0 overflow-hidden">
				{/* Server Header */}
				<div className="h-12 border-b border-border flex items-center px-4 shrink-0 transition-colors hover:bg-accent/30 cursor-pointer">
					<div className="flex-1 flex flex-row justify-between items-center min-w-0">
						<h2 className="font-bold text-[15px] text-foreground truncate leading-tight">
							NodeTalk Client
						</h2>
						<span className="text-[11px] text-muted-foreground font-medium inline-flex items-center gap-1.5 shrink-0">
							{appVersion}
							<span
								className={`w-2 h-2 rounded-full ${
									wsState === 'connected'
										? 'bg-green-500'
										: wsState === 'connecting'
											? 'bg-yellow-500'
											: 'bg-red-500'
								}`}
								title={wsState}
							/>
						</span>
					</div>
				</div>

				{/* Mobile Horizontal NavStrip */}
				{isMobile && (
					<NavStrip
						activeTab={activeTab}
						onChange={setActiveTab}
						orientation="horizontal"
					/>
				)}

				{/* Search area */}
				<div className="px-2.5 pt-2.5 pb-2 shrink-0 flex items-center gap-1.5 min-w-0 w-full">
					<button
						type="button"
						onClick={() => setShowSearchDialog(true)}
						className="min-w-0 flex-1 flex items-center bg-popover hover:bg-accent/60 border border-border/40 text-[13px] h-8 px-2.5 gap-2 text-muted-foreground hover:text-foreground rounded-md transition cursor-pointer group select-none overflow-hidden"
						title={`Search conversations (${isMac() ? '⌘K' : 'Ctrl+K'})`}
					>
						<Search className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition" />
						<span className="truncate min-w-0 text-xs text-left">
							Search...
						</span>
						<kbd className="hidden lg:inline-flex items-center gap-0.5 pointer-events-none select-none h-5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground bg-muted border border-border/60 rounded shrink-0 ml-auto">
							<span className="text-xs leading-none">
								{isMac() ? '⌘' : 'Ctrl'}
							</span>
							<span className="leading-none">K</span>
						</kbd>
					</button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 cursor-pointer rounded-md flex items-center justify-center"
						onClick={() => {
							setModalTab('channel');
							setShowNew(true);
						}}
						title="New conversation"
					>
						<Plus className="w-4 h-4 shrink-0" />
					</Button>
				</div>

				{/* Channel Lists */}
				<ScrollArea className="flex-1 w-full min-h-0">
					{isLoading ? (
						<div className="flex justify-center py-4">
							<span className="spinner" />
						</div>
					) : (
						<div className="pb-4">
							<div className="flex flex-col gap-0.5 px-2 mt-2">
								{visibleChannels.map((ch) => {
									const isDM = isDirectMessage(ch);
									const otherId = isDM
										? ch.members.find((m) => m !== user?.id) || ch.id
										: null;
									const isBlocked =
										isDM &&
										relationships.some(
											(r) => r.to_user_id === otherId && r.type === 'blocked',
										);
									return (
										<RenderChannel
											key={ch.id}
											ch={ch}
											isGroup={!isDM}
											user={user}
											isActive={activeChannelId === ch.id}
											isBlocked={isBlocked}
											onSelect={handleSelectChannel}
											onDeleteDM={handleDeleteDM}
											onViewProfile={handleViewProfile}
										/>
									);
								})}
							</div>

							{visibleChannels.length === 0 && !isLoading && !search && (
								<div className="text-center mt-6 text-muted-foreground text-xs px-4">
									No conversations. Click + to start!
								</div>
							)}

							{search && (
								<div className="mt-6">
									<div className="flex items-center justify-between px-4 mb-[2px]">
										<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
											Public Channels
										</span>
									</div>
									{isExploring ? (
										<div className="flex justify-center py-4">
											<span className="spinner" />
										</div>
									) : exploreChannels.length > 0 ? (
										<div className="flex flex-col gap-0.5 mt-2">
											{exploreChannels.map((ch) => {
												const isJoined = channels.some((c) => c.id === ch.id);
												if (isJoined) return null;

												return (
													<div
														key={ch.id}
														onClick={() =>
															handleJoinChannel(ch.invite_link, ch.id)
														}
														className="flex items-center justify-between px-2 py-1.5 mx-2 rounded-md cursor-pointer select-none transition min-w-0 overflow-hidden text-muted-foreground hover:bg-accent/50 hover:text-foreground"
													>
														<div className="flex items-center gap-3 min-w-0 flex-1 mr-2 pointer-events-none select-none">
															<Hash className="w-5 h-5 shrink-0 opacity-70" />
															<span className="truncate text-[15px] font-medium leading-none min-w-0 flex-1">
																{ch.name}
															</span>
														</div>
														{isJoining === ch.id ? (
															<span className="spinner small" />
														) : (
															<span className="text-xs font-semibold text-[#5865F2] pointer-events-none">
																Join
															</span>
														)}
													</div>
												);
											})}
										</div>
									) : (
										<div className="text-center mt-2 text-muted-foreground text-xs px-4">
											No public channels found.
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</ScrollArea>

				{/* User Controls Footer */}
				<div className="h-[52px] bg-secondary/80 backdrop-blur-sm shrink-0 flex items-center px-2 gap-2 border-t border-border/50">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<div className="flex items-center gap-2 flex-1 min-w-0 hover:bg-accent p-1 h-10 rounded-md cursor-pointer select-none transition">
								<div className="relative pointer-events-none">
									<Avatar
										userId={user?.id || ''}
										avatarId={user?.avatar_id}
										size={32}
										className="shrink-0"
									/>
									<div
										className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2px] border-secondary z-10 ${
											user?.status === 'online'
												? 'bg-green-500'
												: user?.status === 'away'
													? 'bg-yellow-500'
													: user?.status === 'dnd'
														? 'bg-red-500'
														: 'bg-gray-500'
										}`}
									/>
								</div>
								<div className="flex flex-col flex-1 min-w-0 leading-tight pointer-events-none select-none">
									<span className="text-[13px] font-bold text-foreground truncate">
										{user?.username}
									</span>
									<span className="text-[11px] text-muted-foreground truncate">
										{user?.status
											? user.status.charAt(0).toUpperCase() +
												user.status.slice(1)
											: 'Offline'}
									</span>
								</div>
							</div>
						</DropdownMenuTrigger>

						<DropdownMenuContent
							align="start"
							className="w-48 bg-popover border-border text-foreground"
						>
							<DropdownMenuItem
								onClick={logout}
								className="text-red-400 hover:text-red-300 focus:bg-[#f23f42] focus:text-white cursor-pointer"
							>
								<LogOut className="mr-2 h-4 w-4 pointer-events-none" />
								<span className="pointer-events-none">Log out</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer rounded-md shrink-0 flex items-center justify-center"
						onClick={() => setShowSettings(true)}
						title="Settings"
					>
						<Settings className="w-6 h-6 pointer-events-none" />
					</Button>
				</div>
			</div>

			{showNewChannel && (
				<NewChannelModal
					initialTab={modalTab}
					onClose={() => setShowNew(false)}
				/>
			)}
			{showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
			{deleteDmTarget && (
				<DeleteChatModal
					channel={deleteDmTarget}
					isOpen={!!deleteDmTarget}
					onClose={() => setDeleteDmTarget(null)}
				/>
			)}
			{selectedProfileUserId && (
				<UserProfileModal
					userId={selectedProfileUserId}
					open={!!selectedProfileUserId}
					onOpenChange={(open) => !open && setSelectedProfileUserId(null)}
				/>
			)}
			<ConversationSearchDialog
				open={showSearchDialog}
				onOpenChange={setShowSearchDialog}
				onCreateNew={(tab) => {
					setModalTab(tab);
					setShowNew(true);
				}}
			/>
		</div>
	);
}
