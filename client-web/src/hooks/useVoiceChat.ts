import { useVoiceStore } from '@/store/voiceStore';
import { webRTCManager } from '@/rtc/WebRTCManager';

/**
 * Hook for components to trigger WebRTC voice and video call actions.
 */
export const useVoiceChat = () => {
	const activeChannelId = useVoiceStore((s) => s.activeChannelId);
	const isActive = useVoiceStore((s) => s.isActive);
	const isMuted = useVoiceStore((s) => s.isMuted);
	const isDeafened = useVoiceStore((s) => s.isDeafened);
	const isVideoEnabled = useVoiceStore((s) => s.isVideoEnabled);
	const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
	const callStatus = useVoiceStore((s) => s.callStatus);

	return {
		activeChannelId,
		isActive,
		isMuted,
		isDeafened,
		isVideoEnabled,
		isScreenSharing,
		callStatus,

		startCall: (channelId: string, options?: { video?: boolean }) => webRTCManager.join(channelId, options),
		stopCall: () => webRTCManager.leave(),

		// Backward-compatible aliases
		startVoice: (channelId: string) => webRTCManager.join(channelId),
		stopVoice: () => webRTCManager.leave(),

		toggleMute: () => webRTCManager.toggleMute(),
		toggleDeafen: () => webRTCManager.toggleDeafen(),
		toggleVideo: () => webRTCManager.toggleVideo(),
		toggleScreenShare: () => webRTCManager.toggleScreenShare(),
	};
};
