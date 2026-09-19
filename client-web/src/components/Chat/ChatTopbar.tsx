import { useState, Profiler } from 'react';
import { logProfiler } from '@/utils/profiler';

import { Avatar, ChannelInitialsAvatar } from '../Avatar';
import {
	Search,
	SlidersHorizontal,
	X,
	ChevronLeft,
	Users,
	Mic,
	UserPlus,
	Check,
	Clock,
	Loader2,
	Trash2,
} from 'lucide-react';
import { type Channel } from '@/types/api';
import {
	getChannelDisplayName,
	useAppStore,
	useAuthStore,
	useChannelStore,
} from '@/store/store';
import { GroupSettingsModal } from './GroupSettingsModal';
import { ChannelInfoModal } from './ChannelInfoModal';
import { isDirectMessage } from '@/utils/channel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isAdmin } from '@/utils/role';
import { isWails } from '@/utils/wails';
import { useVoiceChat } from '@/hooks/useVoiceChat';
import { useVoiceStore } from '@/store/voiceStore';

import { UserProfileModal } from '../UserProfileModal';
import { DeleteChatModal } from './DeleteChatModal';
import { getFileUrl } from '@/api/client';

interface ChatTopbarProps {
	channel: Channel;
	currentUserId: string;
	searchQuery: string;
	onSearchChange: (query: string) => void;
}

export const ChatTopbar: React.FC<ChatTopbarProps> = ({
	channel,
	currentUserId: propUserId,
	searchQuery,
	onSearchChange,
}) => {
	const [showSettings, setShowSettings] = useState(false);
	const [showUserProfile, setShowUserProfile] = useState(false);
	const [showChannelInfo, setShowChannelInfo] = useState(false);
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [isSearching, setIsSearching] = useState(false);

	const authUserId = useAuthStore((state) => state.user?.id);
	const currentUserId = authUserId || propUserId;

	// Use reactive channel from store if available
	const liveChannel = useChannelStore(
		(state) => state.channels.find((c) => c.id === channel.id),
	) || channel;

	const isDM = isDirectMessage(liveChannel);
	const otherMemberId =
		liveChannel.members.find((m) => m !== currentUserId) ||
		liveChannel.members[0] ||
		liveChannel.id;

	const otherStatus = liveChannel.member_statuses?.[otherMemberId] || 'offline';
	const dmSubtitle = otherStatus.charAt(0).toUpperCase() + otherStatus.slice(1);

	// Only show settings icon for admins/owners of group channels
	const canManage = !isDM && isAdmin(liveChannel.user_role);

	const relationships = useAuthStore((state) => state.relationships);
	const incomingRequests = useAuthStore((state) => state.incomingRequests);
	const relationshipAction = useAuthStore((state) => state.relationshipAction);
	const [isSendingFriendReq, setIsSendingFriendReq] = useState(false);

	const outgoingRel = relationships.find((r) => r.to_user_id === otherMemberId);
	const incomingReq = incomingRequests.find((r) => r.from_user_id === otherMemberId);
	const isFriend = outgoingRel?.type === 'friend';
	const isRequested = outgoingRel?.type === 'requested';
	const isBlocked = outgoingRel?.type === 'blocked';
	const canAddFriend = isDM && otherMemberId !== currentUserId && !isFriend && !isBlocked;

	const isMobile = useMediaQuery('(max-width: 768px)');
	const { setRightSidebarOpen, isRightSidebarOpen } = useAppStore();
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const { startVoice, stopVoice } = useVoiceChat();
	const isActive = useVoiceStore(
		(state) => state.isActive && state.activeChannelId === liveChannel.id,
	);

	return (
		<Profiler id="ChatTopbar" onRender={logProfiler}>
			<div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0 relative z-10 bg-background">
				<div className="flex items-center gap-2 min-w-0">
					{isMobile && (
						<button
							onClick={() => setActiveChannel(null)}
							className="p-1 -ml-2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
						>
							<ChevronLeft size={26} />
						</button>
					)}
					<div className="flex items-center gap-3 min-w-0">
						{isDM ? (
							<button
								type="button"
								onClick={() => setShowUserProfile(true)}
								className="flex items-center gap-3 text-left hover:opacity-85 transition min-w-0 cursor-pointer group"
								title="View profile"
							>
								<div className="relative shrink-0 pointer-events-none">
									<Avatar
										userId={otherMemberId}
										avatarId={liveChannel.member_avatars?.[otherMemberId]}
										size={40}
									/>
									<div
										className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2px] border-background z-10 ${
											otherStatus === 'online'
												? 'bg-green-500'
												: otherStatus === 'away'
													? 'bg-yellow-500'
													: otherStatus === 'dnd'
														? 'bg-red-500'
														: 'bg-gray-500'
										}`}
									/>
								</div>
								<div className="flex flex-col min-w-0 pointer-events-none">
									<div className="text-[15px] font-bold text-foreground leading-tight truncate">
										{getChannelDisplayName(liveChannel, currentUserId)}
									</div>
									<div className="text-[12px] text-muted-foreground leading-tight mt-0.5">
										{dmSubtitle}
									</div>
								</div>
							</button>
						) : (
							<button
								type="button"
								onClick={() => setShowChannelInfo(true)}
								className="flex items-center gap-3 text-left hover:opacity-85 transition min-w-0 cursor-pointer group"
								title="View channel info"
							>
								{liveChannel.avatar_id ? (
									<div className="w-10 h-10 rounded-full overflow-hidden bg-secondary border border-border/40 shrink-0 pointer-events-none">
										<img
											src={getFileUrl(liveChannel.avatar_id)}
											alt={liveChannel.name}
											className="w-full h-full object-cover"
											draggable={false}
										/>
									</div>
								) : (
									<ChannelInitialsAvatar id={liveChannel.id} name={liveChannel.name} size={40} />
								)}
								<div className="flex flex-col min-w-0 pointer-events-none">
									<div
										className="text-[15px] font-bold text-foreground leading-tight truncate"
										title={liveChannel.name}
									>
										{getChannelDisplayName(liveChannel, currentUserId)}
									</div>
									<div
										className="text-[12px] text-muted-foreground leading-tight truncate max-w-[200px] sm:max-w-xs md:max-w-md mt-0.5"
										title={liveChannel.description || undefined}
									>
										{liveChannel.description
											? liveChannel.description
											: `${liveChannel.members?.length ?? 0} members`}
									</div>
								</div>
							</button>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2 sm:gap-3 text-muted-foreground">
					{/* Add Friend button if DM and not friends */}
					{canAddFriend && (
						<div>
							{isRequested ? (
								<div
									className="p-1 text-muted-foreground select-none"
									title="Friend request pending"
								>
									<Clock size={20} className="text-amber-500 opacity-80" />
								</div>
							) : incomingReq ? (
								<button
									type="button"
									disabled={isSendingFriendReq}
									onClick={async () => {
										setIsSendingFriendReq(true);
										try {
											await relationshipAction(otherMemberId, 'accept');
										} catch (err) {
											console.error('Failed to accept friend request', err);
										} finally {
											setIsSendingFriendReq(false);
										}
									}}
									className="p-1 hover:text-emerald-400 text-emerald-500 transition cursor-pointer"
									title="Accept Friend Request"
								>
									{isSendingFriendReq ? (
										<Loader2 size={20} className="animate-spin" />
									) : (
										<Check size={20} />
									)}
								</button>
							) : (
								<button
									type="button"
									disabled={isSendingFriendReq}
									onClick={async () => {
										setIsSendingFriendReq(true);
										try {
											await relationshipAction(otherMemberId, 'request');
										} catch (err) {
											console.error('Failed to send friend request', err);
										} finally {
											setIsSendingFriendReq(false);
										}
									}}
									className="p-1 hover:text-foreground text-muted-foreground transition cursor-pointer"
									title="Add Friend"
								>
									{isSendingFriendReq ? (
										<Loader2 size={20} className="animate-spin" />
									) : (
										<UserPlus size={20} className="opacity-70 hover:opacity-100 transition-opacity" />
									)}
								</button>
							)}
						</div>
					)}

					<div
						className={`flex items-center bg-secondary/50 rounded-lg px-2 transition-all duration-200 ${isSearching || searchQuery ? 'w-44 sm:w-64 md:w-72 ring-1 ring-primary/20' : 'w-9 bg-transparent'}`}
					>
						<button
							onClick={() => setIsSearching(!isSearching)}
							className="hover:text-foreground transition p-1"
							title="Search"
						>
							<Search
								size={20}
								className={`${isSearching || searchQuery ? 'text-primary opacity-100' : 'opacity-70'}`}
							/>
						</button>
						{(isSearching || searchQuery) && (
							<>
								<input
									autoFocus
									type="text"
									placeholder="Search..."
									value={searchQuery}
									onChange={(e) => onSearchChange(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Escape') {
											onSearchChange('');
											setIsSearching(false);
										}
									}}
									className="bg-transparent border-none outline-none text-sm w-full ml-1 text-foreground placeholder:text-muted-foreground/50"
									onBlur={() => {
										if (!searchQuery) setIsSearching(false);
									}}
								/>
								<button
									onClick={() => {
										if (searchQuery) {
											onSearchChange('');
										} else {
											setIsSearching(false);
										}
									}}
									className="p-1 hover:text-foreground"
								>
									<X size={14} />
								</button>
							</>
						)}
					</div>

					{isMobile && !isDM && (
						<button
							onClick={() => setRightSidebarOpen(!isRightSidebarOpen)}
							className={`p-1 hover:text-foreground transition ${isRightSidebarOpen ? 'text-primary' : ''}`}
							title="Show Members"
						>
							<Users size={22} />
						</button>
					)}

					{canManage && (
						<button
							onClick={() => setShowSettings(true)}
							className="hover:text-foreground transition"
							title="Channel Settings"
						>
							<SlidersHorizontal
								size={22}
								className="opacity-80 hover:opacity-100"
							/>
						</button>
					)}

					{isDM && (
						<button
							type="button"
							onClick={() => setShowDeleteModal(true)}
							className="hover:text-destructive text-muted-foreground transition p-1 cursor-pointer"
							title="Delete Chat"
						>
							<Trash2
								size={20}
								className="opacity-80 hover:opacity-100"
							/>
						</button>
					)}

					{isWails() && (
						<button
							onClick={() => (isActive ? stopVoice() : startVoice(channel.id))}
							className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-200 ${
								isActive
									? 'bg-primary/10 text-primary border border-primary/30'
									: 'hover:bg-secondary text-muted-foreground hover:text-foreground'
							}`}
							title={isActive ? 'Leave Voice Chat' : 'Join Voice Chat'}
						>
							<Mic size={20} />
						</button>
					)}
				</div>

				{showSettings && (
					<GroupSettingsModal
						channel={liveChannel}
						onClose={() => setShowSettings(false)}
					/>
				)}

				{showUserProfile && (
					<UserProfileModal
						userId={otherMemberId}
						open={showUserProfile}
						onOpenChange={setShowUserProfile}
					/>
				)}

				{showChannelInfo && (
					<ChannelInfoModal
						channel={liveChannel}
						open={showChannelInfo}
						onOpenChange={setShowChannelInfo}
						onOpenSettings={() => setShowSettings(true)}
					/>
				)}

				{showDeleteModal && (
					<DeleteChatModal
						channel={liveChannel}
						isOpen={showDeleteModal}
						onClose={() => setShowDeleteModal(false)}
					/>
				)}
			</div>
		</Profiler>
	);
};

(ChatTopbar as any).whyDidYouRender = true;
