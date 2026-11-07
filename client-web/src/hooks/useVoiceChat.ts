import { useVoiceStore } from '@/store/voiceStore';
import { webRTCManager } from '@/rtc/WebRTCManager';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import { callsNeedNativeClient } from '@/lib/call-support';

/**
 * Hook for components to trigger WebRTC voice and video call actions.
 *
 * On an air-gapped server (`voice.mode = "raw_udp"`) calls run over the encrypted UDP media path, which a browser
 * cannot speak. There `callsBlocked` is true, the start/join actions do nothing except tell the user to use a native
 * client, and call buttons should render disabled.
 */
export const useVoiceChat = () => {
	const { t } = useTranslation();
	const { capabilities } = useServerCapabilities();
	const callsBlocked = callsNeedNativeClient(capabilities);
	/** Runs `action` unless calls need a native client, in which case it explains why instead. */
	const guarded = <A extends unknown[]>(action: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
		if (callsBlocked) {
			toast.info(t('calls.nativeRequired'));
			return;
		}
		await action(...args);
	};
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
		callsBlocked,

		startCall: guarded((channelId: string, options?: { video?: boolean }) => webRTCManager.join(channelId, options)),
		stopCall: () => webRTCManager.leave(),

		// Backward-compatible aliases
		startVoice: guarded((channelId: string) => webRTCManager.join(channelId)),
		stopVoice: () => webRTCManager.leave(),

		toggleMute: () => webRTCManager.toggleMute(),
		toggleDeafen: () => webRTCManager.toggleDeafen(),
		toggleVideo: () => webRTCManager.toggleVideo(),
		toggleScreenShare: () => webRTCManager.toggleScreenShare(),
	};
};
