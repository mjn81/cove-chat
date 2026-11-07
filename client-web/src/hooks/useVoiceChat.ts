import { useVoiceStore } from '@/store/voiceStore';
import { callManager, setCallTransport } from '@/rtc/call-manager';
import { setUdpPort } from '@/rtc/UdpMediaManager';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import { callsNeedNativeClient, useUdpMediaTransport } from '@/lib/call-support';

/**
 * Hook for components to trigger voice and video call actions.
 *
 * On an air-gapped server (`voice.mode = "raw_udp"`) calls run over the encrypted UDP media path, which a browser
 * cannot speak (the desktop app can, see UdpMediaManager). There `callsBlocked` is true, the start/join actions do nothing except tell the user to use a native
 * client, and call buttons should render disabled.
 */
export const useVoiceChat = () => {
	const { t } = useTranslation();
	const { capabilities, udpPort } = useServerCapabilities();
	const udpTransport = useUdpMediaTransport(capabilities);
	const callsBlocked = callsNeedNativeClient(capabilities);
	useEffect(() => {
		setCallTransport(udpTransport);
		setUdpPort(udpPort);
	}, [udpTransport, udpPort]);
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

		startCall: guarded((channelId: string, options?: { video?: boolean }) => callManager.join(channelId, options)),
		stopCall: () => callManager.leave(),

		// Backward-compatible aliases
		startVoice: guarded((channelId: string) => callManager.join(channelId)),
		stopVoice: () => callManager.leave(),

		toggleMute: () => callManager.toggleMute(),
		toggleDeafen: () => callManager.toggleDeafen(),
		toggleVideo: () => callManager.toggleVideo(),
		toggleScreenShare: () => callManager.toggleScreenShare(),
	};
};
