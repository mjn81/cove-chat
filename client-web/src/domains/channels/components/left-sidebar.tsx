import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { ScrollArea } from '@/components/ui/scroll-area';
import { NavStrip } from '@/components/Layout/NavStrip';
import NewChannelModal from '@/components/NewChannelModal';
import SettingsModal from '@/components/SettingsModal';
import { ConversationSearchDialog } from './conversation-search-dialog';
import { DeleteChatModal } from '@/components/Chat/DeleteChatModal';
import { UserProfileModal } from '@/components/UserProfileModal';
import { SidebarUserFooter } from '@/domains/users/components/sidebar-user-footer';
import { CollapsedVoiceButton, VoiceConnectedBar } from '@/domains/voice/components/voice-connected';
import { useAppStore, useAuthStore, useChannelStore, getChannelDisplayName } from '@/store/store';
import { useVoiceStore } from '@/store/voiceStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isDirectMessage } from '@/utils/channel';
import { cn } from '@/lib/utils';
import type { Channel } from '@/types/api';
import { useSidebarChannels } from '../hooks/use-sidebar-channels';
import { ChannelRow } from './channel-row';
import { ExploreChannels } from './explore-channels';
import { SidebarActions } from './sidebar-actions';
import { SidebarHeader } from './sidebar-header';

interface LeftSidebarProps {
	isCollapsed?: boolean;
	onToggleCollapse?: () => void;
}

/**
 * The conversation sidebar: header, search/new buttons, the filtered
 * conversation list (plus public-channel discovery while searching), the
 * active voice call and the user footer. Owns the modals it can open.
 */
export default function LeftSidebar({ isCollapsed = false, onToggleCollapse }: LeftSidebarProps) {
	const { t } = useTranslation();
	const isMobile = useMediaQuery('(max-width: 768px)');

	const user = useAuthStore((s) => s.user);
	const logout = useAuthStore((s) => s.logout);
	const relationships = useAuthStore((s) => s.relationships);
	const channels = useChannelStore((s) => s.channels);
	const activeChannelId = useChannelStore((s) => s.activeChannel?.id);
	const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
	const appVersion = useAppStore((s) => s.appVersion);
	const fetchVersion = useAppStore((s) => s.fetchVersion);
	const wsState = useAppStore((s) => s.wsState);
	const activeTab = useAppStore((s) => s.sidebarTab);
	const setActiveTab = useAppStore((s) => s.setSidebarTab);
	const isVoiceActive = useVoiceStore((s) => s.isActive);
	const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
	const ping = useVoiceStore((s) => s.ping);

	const {
		search,
		isLoading,
		visibleChannels,
		joinableChannels,
		isExploring,
		isJoining,
		joinChannel,
	} = useSidebarChannels(activeTab);

	const [showNewChannel, setShowNewChannel] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [showSearchDialog, setShowSearchDialog] = useState(false);
	const [deleteDmTarget, setDeleteDmTarget] = useState<Channel | null>(null);
	const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null);
	const [modalTab, setModalTab] = useState<'dm' | 'channel'>('dm');

	const activeVoiceChannel = channels.find((c) => c.id === activeVoiceChannelId);
	const activeVoiceChannelName = activeVoiceChannel
		? getChannelDisplayName(activeVoiceChannel, user?.id ?? '')
		: t('sidebar.voice_default_name');

	const handleSelectChannel = useCallback((ch: Channel) => setActiveChannel(ch), [setActiveChannel]);
	const handleDeleteDM = useCallback((ch: Channel) => setDeleteDmTarget(ch), []);
	const handleViewProfile = useCallback((userId: string) => setSelectedProfileUserId(userId), []);
	const openNewConversation = useCallback((tab: 'dm' | 'channel') => {
		setModalTab(tab);
		setShowNewChannel(true);
	}, []);

	useEffect(() => {
		fetchVersion();
	}, [fetchVersion]);

	// Ctrl/Cmd+K toggles the global conversation search.
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

	return (
		<div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-popover">
			<SidebarHeader
				isCollapsed={isCollapsed}
				canCollapse={!isMobile}
				onToggleCollapse={onToggleCollapse}
				appVersion={appVersion}
				wsState={wsState}
			/>

			{isMobile && (
				<NavStrip activeTab={activeTab} onChange={setActiveTab} orientation="horizontal" />
			)}

			<SidebarActions
				isCollapsed={isCollapsed}
				onOpenSearch={() => setShowSearchDialog(true)}
				onNewConversation={() => openNewConversation('channel')}
			/>

			<ScrollArea className="min-h-0 w-full flex-1">
				{isLoading ? (
					<div className="flex justify-center py-4">
						<span className="spinner" />
					</div>
				) : (
					<div className="pb-4">
						<div
							className={cn(
								'mt-2 flex flex-col gap-0.5',
								isCollapsed ? 'items-center px-1' : 'px-2',
							)}
						>
							{visibleChannels.map((ch) => {
								const isDM = isDirectMessage(ch);
								const otherId = isDM ? ch.members.find((m) => m !== user?.id) || ch.id : null;
								const isBlocked =
									isDM &&
									relationships.some((r) => r.to_user_id === otherId && r.type === 'blocked');
								return (
									<motion.div
										key={ch.id}
										layout="position"
										transition={{ type: 'spring', stiffness: 350, damping: 30, mass: 0.8 }}
										className={isCollapsed ? 'flex w-full justify-center' : 'w-full'}
									>
										<ChannelRow
											ch={ch}
											isGroup={!isDM}
											user={user}
											isActive={activeChannelId === ch.id}
											isBlocked={isBlocked}
											isCollapsed={isCollapsed}
											onSelect={handleSelectChannel}
											onDeleteDM={handleDeleteDM}
											onViewProfile={handleViewProfile}
										/>
									</motion.div>
								);
							})}
						</div>

						{visibleChannels.length === 0 && !search && (
							<div className="mt-6 px-4 text-center text-xs text-muted-foreground">
								{isCollapsed ? t('sidebar.empty_collapsed') : t('sidebar.empty')}
							</div>
						)}

						{search && (
							<ExploreChannels
								channels={joinableChannels}
								isLoading={isExploring}
								joiningId={isJoining}
								onJoin={joinChannel}
							/>
						)}
					</div>
				)}
			</ScrollArea>

			{isVoiceActive && !isCollapsed && (
				<VoiceConnectedBar ping={ping} channelName={activeVoiceChannelName} />
			)}

			<SidebarUserFooter
				user={user}
				isCollapsed={isCollapsed}
				onViewProfile={handleViewProfile}
				onOpenSettings={() => setShowSettings(true)}
				onLogout={logout}
				collapsedExtra={
					isVoiceActive ? (
						<CollapsedVoiceButton ping={ping} channelName={activeVoiceChannelName} />
					) : undefined
				}
			/>

			{showNewChannel && (
				<NewChannelModal initialTab={modalTab} onClose={() => setShowNewChannel(false)} />
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
				onCreateNew={openNewConversation}
			/>
		</div>
	);
}
