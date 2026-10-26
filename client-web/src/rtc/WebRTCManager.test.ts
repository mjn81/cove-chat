import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebRTCManager } from './WebRTCManager';
import { useVoiceStore } from '@/store/voiceStore';
import * as wsModule from '@/ws';

const wsHandlers: Record<string, (payload: unknown) => unknown> = {};

vi.mock('@/ws', () => ({
	onWS: vi.fn((event: string, fn: (payload: unknown) => unknown) => {
		wsHandlers[event] = fn;
		return vi.fn();
	}),
	wsSendCallJoin: vi.fn(),
	wsSendCallLeave: vi.fn(),
	wsSendCallPublishOffer: vi.fn(),
	wsSendCallSubscribeAnswer: vi.fn(),
	wsSendCallICECandidate: vi.fn(),
	wsSendCallTrackState: vi.fn(),
	wsSendCallRequestKeyframe: vi.fn(),
}));

describe('WebRTCManager', () => {
	let manager: WebRTCManager;

	beforeEach(() => {
		vi.clearAllMocks();
		useVoiceStore.setState({
			activeChannelId: null,
			isActive: false,
			callStatus: 'idle',
			isMuted: false,
			isDeafened: false,
			isVideoEnabled: false,
			isScreenSharing: false,
			localStream: null,
			localScreenStream: null,
			remoteStreams: {},
			remoteScreenStreams: {},
			participantTrackStates: {},
			speakingUsers: new Set(),
			participants: {},
			logs: [],
			userVolumes: {},
			userMutes: new Set(),
			screenShareVolumes: {},
			screenShareMutes: {},
			spotlightStreamId: null,
		});

		manager = new WebRTCManager();
	});

	it('transitions store to connecting and sends call_join on join()', async () => {
		await manager.join('channel-123');

		const state = useVoiceStore.getState();
		expect(state.activeChannelId).toBe('channel-123');
		expect(state.isActive).toBe(true);
		expect(state.callStatus).toBe('connecting');
		expect(wsModule.wsSendCallJoin).toHaveBeenCalledWith('channel-123');
	});

	it('toggles deafen state in store', () => {
		expect(useVoiceStore.getState().isDeafened).toBe(false);
		manager.toggleDeafen();
		expect(useVoiceStore.getState().isDeafened).toBe(true);
		manager.toggleDeafen();
		expect(useVoiceStore.getState().isDeafened).toBe(false);
	});

	it('leaves the current call before joining a different channel', async () => {
		await manager.join('channel-a');
		await manager.join('channel-b');

		expect(wsModule.wsSendCallLeave).toHaveBeenCalledWith('channel-a');
		expect(wsModule.wsSendCallJoin).toHaveBeenLastCalledWith('channel-b');
		expect(useVoiceStore.getState().activeChannelId).toBe('channel-b');
	});

	it('ignores a duplicate join of the same channel', async () => {
		await manager.join('channel-a');
		await manager.join('channel-a');
		expect(wsModule.wsSendCallJoin).toHaveBeenCalledTimes(1);
	});

	it('clears mute and deafen state when the call ends', async () => {
		await manager.join('channel-a');
		useVoiceStore.setState({ isMuted: true, isDeafened: true });
		await manager.leave();
		expect(useVoiceStore.getState().isMuted).toBe(false);
		expect(useVoiceStore.getState().isDeafened).toBe(false);
	});

	it('resets store and sends call_leave on leave()', async () => {
		await manager.join('channel-abc');
		await manager.leave();

		const state = useVoiceStore.getState();
		expect(state.activeChannelId).toBeNull();
		expect(state.isActive).toBe(false);
		expect(state.callStatus).toBe('idle');
		expect(wsModule.wsSendCallLeave).toHaveBeenCalledWith('channel-abc');
	});

	it('adjusts participant volume and user mute in store', () => {
		manager.setParticipantVolume('user-99', 1.5);
		expect(useVoiceStore.getState().userVolumes['user-99']).toBe(1.5);

		manager.toggleParticipantMute('user-99');
		expect(useVoiceStore.getState().userMutes.has('user-99')).toBe(true);
		manager.toggleParticipantMute('user-99');
		expect(useVoiceStore.getState().userMutes.has('user-99')).toBe(false);
	});

	it('manages per-stream screen share volume and mute independently', () => {
		manager.setScreenShareVolume('user-42', 1.75);
		expect(useVoiceStore.getState().screenShareVolumes['user-42']).toBe(1.75);

		manager.toggleScreenShareMute('user-42');
		expect(useVoiceStore.getState().screenShareMutes['user-42']).toBe(true);
		manager.toggleScreenShareMute('user-42');
		expect(useVoiceStore.getState().screenShareMutes['user-42']).toBe(false);
	});

	it('sends call_request_keyframe when requestKeyframe is called', async () => {
		await manager.join('channel-keyframe-test');
		manager.requestKeyframe('user-presenter');
		expect(wsModule.wsSendCallRequestKeyframe).toHaveBeenCalledWith('channel-keyframe-test', 'user-presenter');
	});

	it('updates screen share settings in store when applyScreenShareConstraints is invoked', async () => {
		await manager.applyScreenShareConstraints({
			resolution: '720p',
			frameRate: 60,
			aspectRatio: '16/9',
			contentHint: 'motion',
		});

		const settings = useVoiceStore.getState().screenShareSettings;
		expect(settings.resolution).toBe('720p');
		expect(settings.frameRate).toBe(60);
		expect(settings.aspectRatio).toBe('16/9');
		expect(settings.contentHint).toBe('motion');
	});

	it('builds the peer connections even when the server sends null ice_servers', async () => {
		class FakePC {
			signalingState = 'stable';
			connectionState = 'new';
			remoteDescription = null;
			addTrack = vi.fn();
			close = vi.fn();
			createOffer = vi.fn(async () => ({ type: 'offer', sdp: '' }));
			setLocalDescription = vi.fn(async () => {});
		}
		vi.stubGlobal('RTCPeerConnection', FakePC);
		vi.stubGlobal('MediaStream', class {});
		vi.stubGlobal('navigator', {
			mediaDevices: { getUserMedia: vi.fn(() => Promise.reject(new DOMException('no mic', 'NotAllowedError'))) },
		});

		await manager.join('channel-x');
		await wsHandlers['call_joined']({
			channel_id: 'channel-x',
			self_id: 'me',
			ice_servers: null,
			participants: null,
		});

		expect(useVoiceStore.getState().callStatus).toBe('connected');
		expect(useVoiceStore.getState().isMuted).toBe(true);
		vi.unstubAllGlobals();
	});
});
