import type { ScreenShareSettings } from '@/store/voiceStore';
import { webRTCManager, type WebRTCOptions } from './WebRTCManager';
import { udpMediaManager } from './UdpMediaManager';

/** The call API the UI uses; implemented by both WebRTCManager and UdpMediaManager. */
export interface CallManager {
	join(channelId: string, options?: WebRTCOptions): Promise<void>;
	leave(): Promise<void>;
	toggleMute(): Promise<void>;
	toggleDeafen(): void;
	toggleVideo(): Promise<void>;
	toggleScreenShare(customSettings?: Partial<ScreenShareSettings>): Promise<void>;
	applyScreenShareConstraints(newSettings: Partial<ScreenShareSettings>): Promise<void>;
	requestKeyframe(targetUserId?: string): void;
	setScreenShareVolume(userId: string, volume: number): void;
	toggleScreenShareMute(userId: string): void;
	setParticipantVolume(userId: string, volume: number): void;
	toggleParticipantMute(userId: string): void;
}

let udp = false;
/** Chooses the transport for the next calls: the UDP manager on air-gapped servers in the desktop app, else WebRTC. */
export function setCallTransport(useUdp: boolean): void {
	udp = useUdp;
}

/** Which manager a call that starts now would use. */
export function activeCallManager(): CallManager {
	return udp ? udpMediaManager : webRTCManager;
}

let current: CallManager = webRTCManager;
const pick = (join: boolean): CallManager => {
	// A running call stays on the manager that started it even if the transport flag changes meanwhile.
	if (join) current = activeCallManager();
	return current;
};

/** Delegating singleton used by all call UI. */
export const callManager: CallManager = {
	join: (c, o) => pick(true).join(c, o),
	leave: () => pick(false).leave(),
	toggleMute: () => pick(false).toggleMute(),
	toggleDeafen: () => pick(false).toggleDeafen(),
	toggleVideo: () => pick(false).toggleVideo(),
	toggleScreenShare: (s) => pick(false).toggleScreenShare(s),
	applyScreenShareConstraints: (s) => pick(false).applyScreenShareConstraints(s),
	requestKeyframe: (u) => pick(false).requestKeyframe(u),
	setScreenShareVolume: (u, v) => pick(false).setScreenShareVolume(u, v),
	toggleScreenShareMute: (u) => pick(false).toggleScreenShareMute(u),
	setParticipantVolume: (u, v) => pick(false).setParticipantVolume(u, v),
	toggleParticipantMute: (u) => pick(false).toggleParticipantMute(u),
};
