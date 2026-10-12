import React from 'react';
import { useVoiceStore } from '@/store/voiceStore';
import { useAuthStore, useChannelStore } from '@/store/store';
import { VoiceChatPanel } from './VoiceChatPanel';
import { webRTCManager } from '@/rtc/WebRTCManager';

/**
 * Controller component that mounts the active call panel and keeps
 * channel participant presence synchronized with server WebSocket events.
 */
export const VoiceChatController: React.FC = () => {
	const activeChannelId = useVoiceStore((state) => state.activeChannelId);
	const isActive = useVoiceStore((state) => state.isActive);
	const isMuted = useVoiceStore((state) => state.isMuted);
	const isDeafened = useVoiceStore((state) => state.isDeafened);
	const speakingUsers = useVoiceStore((state) => state.speakingUsers);
	const channels = useChannelStore((state) => state.channels);
	const currentUser = useAuthStore((state) => state.user);


	const activeChannel = channels.find((c) => c.id === activeChannelId);
	const participants = useVoiceStore((state) =>
		state.activeChannelId ? state.participants[state.activeChannelId] : undefined
	);
	const currentUserId = currentUser?.id;

	// Guarantee current user is immediately visible upon joining, merged reactively with remote peers
	const displayParticipants = React.useMemo(() => {
		const list = participants || [];
		if (currentUserId && !list.includes(currentUserId)) {
			return [...list, currentUserId];
		}
		return list.length > 0 ? list : currentUserId ? [currentUserId] : [];
	}, [participants, currentUserId]);

	const currentlyOpenChannel = useChannelStore((state) => state.activeChannel);
	const isViewingCallChannel = currentlyOpenChannel?.id === activeChannelId;

	if (!isActive || !activeChannel) return null;

	return (
		<>
			{/* Remote audio is routed directly through WebRTCManager singleton AudioContext for low latency and zero echo */}

			{/* Floating PiP panel is only shown when browsing a DIFFERENT channel than the active call */}
			{!isViewingCallChannel && (
				<VoiceChatPanel
					isActive={isActive}
					isMuted={isMuted}
					isDeafened={isDeafened}
					speakingUsers={speakingUsers}
					onMuteToggle={() => webRTCManager.toggleMute()}
					onDeafenToggle={() => webRTCManager.toggleDeafen()}
					onDisconnect={() => webRTCManager.leave()}
					members={displayParticipants}
					memberAvatars={activeChannel.member_avatars || {}}
					memberNames={activeChannel.member_names || {}}
				/>
			)}
		</>
	);
};
