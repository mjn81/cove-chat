import { useState, Profiler } from 'react';
import { statusDotClass } from '@/domains/users/utils/status';
import { logProfiler } from '@/utils/profiler';

import { Avatar, ChannelInitialsAvatar } from '../Avatar';
import {
	Search,
	SlidersHorizontal,
	X,
	ChevronLeft,
	Users,
	Phone,
	PhoneCall,
	PhoneOff,
	UserPlus,
	Check,
	Clock,
	Loader2,
	Lock,
} from 'lucide-react';
import { type Channel } from '@/types/api';
import {
	getChannelDisplayName,
	useAppStore,
	useAuthStore,
	useChannelStore,
	useWhisperStore,
} from '@/store/store';
import { GroupSettingsModal } from './GroupSettingsModal';
import { ChannelInfoModal } from './ChannelInfoModal';
import { isDirectMessage, isSystemChannel } from '@/utils/channel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isAdmin } from '@/utils/role';
import { useVoiceChat } from '@/hooks/useVoiceChat';
import { useVoiceStore } from '@/store/voiceStore';

import { UserProfileModal } from '../UserProfileModal';
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
	const isRightSidebarOpen = useAppStore((state) => state.isRightSidebarOpen);
	const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const { startVoice, stopVoice } = useVoiceChat();
	const isActive = useVoiceStore(
		(state) => state.isActive && state.activeChannelId === liveChannel.id,
	);
	const channelParticipants = useVoiceStore(
		(state) => state.participants[liveChannel.id],
	);
	const participantCount = channelParticipants?.length ?? 0;
	const hasOngoingCall = participantCount > 0;

	const isWhisperModeActive = useWhisperStore((state) => state.isWhisperModeActive);
	const whisperPeerId = useWhisperStore((state) => state.whisperPeerId);
	const whisperSession = useWhisperStore((state) => state.activeSession);
	const incomingInvite = useWhisperStore((state) => state.incomingInvite);
	const acceptInvite = useWhisperStore((state) => state.acceptInvite);
	const isWhisperActiveHere = isWhisperModeActive && whisperPeerId === otherMemberId;
	const hasSessionForPeer = Boolean(whisperSession && whisperSession.peerId === otherMemberId);
	const hasIncomingInviteForPeer = Boolean(incomingInvite && incomingInvite.initiatorId === otherMemberId);

	return (
		<Profiler id="ChatTopbar" onRender={logProfiler}>
			<div className="desktop-drag flex items-center justify-between gap-1 px-2 sm:px-4 h-12 border-b border-border shrink-0 relative z-10 bg-background">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					{isMobile && (
						<button
							onClick={() => setActiveChannel(null)}
							className="p-1 -ms-2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
						>
							<ChevronLeft size={26} />
						</button>
					)}
					<div className="flex items-center gap-3 min-w-0">
						{isDM ? (
							<button
								type="button"
								onClick={() => setShowUserProfile(true)}
								className="flex items-center gap-3 text-start hover:opacity-85 transition min-w-0 cursor-pointer group"
								title="View profile"
							>
								<div className="relative shrink-0 pointer-events-none">
									<Avatar
										userId={otherMemberId}
										avatarId={liveChannel.member_avatars?.[otherMemberId]}
										size={30}
									/>
									<div
										className={`absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full border-[2px] border-background z-10 ${statusDotClass(otherStatus)}`}
									/>
								</div>
								<div className="flex flex-col min-w-0 pointer-events-none">
									<div className="text-[15px] font-bold text-foreground leading-tight truncate">
										{getChannelDisplayName(liveChannel, currentUserId)}
									</div>
									<div className="text-[12px] text-muted-foreground leading-tight mt-0.5 truncate">
										{dmSubtitle}
									</div>
								</div>
							</button>
						) : (
							<button
								type="button"
								onClick={() => setShowChannelInfo(true)}
								className="flex items-center gap-3 text-start hover:opacity-85 transition min-w-0 cursor-pointer group"
								title="View channel info"
							>
								{liveChannel.avatar_id ? (
									<div className="w-[30px] h-[30px] rounded-full overflow-hidden bg-secondary border border-border/40 shrink-0 pointer-events-none">
										<img
											src={getFileUrl(liveChannel.avatar_id)}
											alt={liveChannel.name}
											className="w-full h-full object-cover"
											draggable={false}
										/>
									</div>
								) : (
									<ChannelInitialsAvatar id={liveChannel.id} name={liveChannel.name} size={30} />
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
				<div className="flex items-center gap-0.5 sm:gap-1.5 text-muted-foreground shrink-0">
					{/* Add Friend button if DM and not friends */}
					{canAddFriend && (
						isRequested ? (
							<div
								className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center text-muted-foreground select-none"
								title="Friend request pending"
							>
								<Clock size={20} className="text-warning opacity-80" />
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
								className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-secondary/60 hover:text-success text-success transition-colors cursor-pointer"
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
								className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-secondary/60 hover:text-foreground text-muted-foreground transition-colors cursor-pointer"
								title="Add Friend"
							>
								{isSendingFriendReq ? (
									<Loader2 size={20} className="animate-spin" />
								) : (
									<UserPlus size={20} className="opacity-70 hover:opacity-100 transition-opacity" />
								)}
							</button>
						)
					)}

					{/* Search button / input */}
					{isSearching || searchQuery ? (
						<div className="flex items-center bg-secondary/60 rounded-lg px-2.5 h-9 w-44 sm:w-64 md:w-72 ring-1 ring-primary/20 transition-all duration-200">
							<button
								type="button"
								onClick={() => {
									if (!searchQuery) setIsSearching(false);
								}}
								className="hover:text-foreground text-primary transition-colors p-1"
								title="Search"
							>
								<Search size={18} />
							</button>
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
								className="bg-transparent border-none outline-none text-sm w-full ms-1 text-foreground placeholder:text-muted-foreground/50"
								onBlur={() => {
									if (!searchQuery) setIsSearching(false);
								}}
							/>
							<button
								type="button"
								onClick={() => {
									if (searchQuery) {
										onSearchChange('');
									} else {
										setIsSearching(false);
									}
								}}
								className="p-1 hover:text-foreground text-muted-foreground"
							>
								<X size={14} />
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => setIsSearching(true)}
							className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							title="Search"
						>
							<Search size={20} className="opacity-70 hover:opacity-100" />
						</button>
					)}

					{isDM && otherMemberId !== currentUserId && (
						<button
							type="button"
							onClick={async () => {
								if (!isFriend) return;
								if (hasIncomingInviteForPeer && incomingInvite) {
									await acceptInvite(incomingInvite);
									return;
								}
								if (isWhisperActiveHere) {
									useWhisperStore.getState().exitWhisperMode();
									return;
								}
								if (hasSessionForPeer) {
									useWhisperStore.getState().enterWhisperMode(otherMemberId);
									return;
								}
								const peerName = getChannelDisplayName(liveChannel, currentUserId);
								const loaded = await useWhisperStore.getState().loadSessionForPeer(otherMemberId, peerName);
								if (!loaded) {
									useWhisperStore.getState().openStartModal(otherMemberId, peerName);
								}
							}}
							disabled={!isFriend}
							className={`relative w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
								!isFriend
									? 'opacity-40 cursor-not-allowed text-muted-foreground'
									: hasIncomingInviteForPeer
									? 'bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 shadow-sm'
									: isWhisperActiveHere
									? 'bg-foreground/15 text-foreground border border-foreground/30 hover:bg-foreground/20 shadow-sm'
									: hasSessionForPeer
									? 'text-foreground/90 hover:bg-secondary/60'
									: 'hover:bg-secondary/60 text-muted-foreground hover:text-foreground'
							}`}
							title={
								!isFriend
									? 'Whisper requires mutual friendship'
									: hasIncomingInviteForPeer
									? `Incoming Whisper request from ${incomingInvite?.initiatorUsername} - click to accept`
									: isWhisperActiveHere
									? 'Exit Whisper Mode'
									: hasSessionForPeer
									? 'Enter Whisper Mode (E2EE)'
									: 'Start Secure Whisper (E2EE)'
							}
						>
							<Lock size={19} className={isWhisperActiveHere || hasIncomingInviteForPeer ? 'text-current' : 'opacity-80 hover:opacity-100'} />
							{hasIncomingInviteForPeer && (
								<span className="absolute top-1 end-1 w-2 h-2 rounded-full bg-primary ring-2 ring-background" />
							)}
						</button>
					)}

					{isMobile && !isDM && (
						<button
							type="button"
							onClick={() => setRightSidebarOpen(!isRightSidebarOpen)}
							className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-secondary/60 hover:text-foreground transition-colors cursor-pointer ${
								isRightSidebarOpen ? 'text-primary bg-primary/10' : 'text-muted-foreground'
							}`}
							title="Show Members"
						>
							<Users size={20} />
						</button>
					)}

					{canManage && (
						<button
							type="button"
							onClick={() => setShowSettings(true)}
							className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							title="Channel Settings"
						>
							<SlidersHorizontal
								size={20}
								className="opacity-80 hover:opacity-100"
							/>
						</button>
					)}

					{/* Call Status / Action Button (Clean unboxed icon with color) */}
					{isSystemChannel(liveChannel) ? null : isActive ? (
						<button
							type="button"
							onClick={() => stopVoice()}
							className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg text-success hover:text-destructive hover:bg-secondary/60 transition-colors cursor-pointer group"
							title="Connected to voice call (Click to disconnect)"
						>
							<PhoneCall size={18} className="animate-pulse group-hover:hidden" />
							<PhoneOff size={18} className="hidden group-hover:block" />
						</button>
					) : hasOngoingCall ? (
						<button
							type="button"
							onClick={() => startVoice(liveChannel.id)}
							className="relative w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg text-success hover:bg-secondary/60 transition-colors cursor-pointer animate-in fade-in"
							title={`Join ongoing voice call (${participantCount} active)`}
						>
							<PhoneCall size={18} className="animate-pulse" />
							<span className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-success text-success-foreground text-[10px] font-bold flex items-center justify-center border-2 border-background tabular-nums">
								{participantCount}
							</span>
						</button>
					) : (
						<button
							type="button"
							onClick={() => startVoice(liveChannel.id)}
							className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							title="Start Voice Call"
						>
							<Phone size={18} className="opacity-80 hover:opacity-100" />
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
			</div>
		</Profiler>
	);
};

(ChatTopbar as any).whyDidYouRender = true;
