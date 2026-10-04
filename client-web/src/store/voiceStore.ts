import { create } from 'zustand';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ParticipantTrackState {
	audio: boolean;
	video: boolean;
	screen: boolean;
}

export interface IncomingCall {
	channelId: string;
	callerId: string;
	callerUsername: string;
	callerAvatarId?: string;
	timestamp: number;
}

export interface VoiceState {
	activeChannelId: string | null;
	isActive: boolean;
	callStatus: CallStatus;
	isMuted: boolean;
	isDeafened: boolean;
	isVideoEnabled: boolean;
	isScreenSharing: boolean;

	localStream: MediaStream | null;
	localScreenStream: MediaStream | null;
	remoteStreams: Record<string, MediaStream>; // userId -> MediaStream (cam/audio)
	remoteScreenStreams: Record<string, MediaStream>; // userId -> MediaStream (screen)
	participantTrackStates: Record<string, ParticipantTrackState>; // userId -> track states
	preferredCameraId: string;
	activePresenterId: string | null;

	speakingUsers: Set<string>;
	participants: Record<string, string[]>; // channelID -> list of userIDs
	logs: string[];
	userVolumes: Record<string, number>; // userID -> volume (0-2)
	userMutes: Set<string>; // userIDs that are locally muted
	incomingCall: IncomingCall | null;
	handledCallChannels: Set<string>; // channel IDs where call was already accepted/declined/joined
	ping: number | null; // RTT ping in milliseconds

	// Actions
	joinVoice: (channelId: string) => void;
	leaveVoice: () => void;
	updateParticipants: (channelId: string, users: string[]) => void;
	setRemoteStream: (userId: string, stream: MediaStream) => void;
	setRemoteScreenStream: (userId: string, stream: MediaStream | null) => void;
	removeRemoteStream: (userId: string) => void;
	setTrackState: (userId: string, kind: 'audio' | 'video' | 'screen', enabled: boolean) => void;
	setPreferredCameraId: (id: string) => void;
	setActivePresenterId: (id: string | null) => void;
	setUserVolume: (userId: string, volume: number) => void;
	toggleUserMute: (userId: string) => void;
	setIncomingCall: (call: IncomingCall | null) => void;
	dismissIncomingCall: () => void;
	markCallHandled: (channelId: string) => void;
	resetHandledCall: (channelId: string) => void;
	setPing: (ping: number | null) => void;
	addLog: (message: string) => void;
	clearLogs: () => void;

	// Internal setters for the controller
	_setInternalState: (state: Partial<VoiceState>) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
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
	preferredCameraId: '',
	activePresenterId: null,

	speakingUsers: new Set(),
	participants: {},
	logs: [],
	userVolumes: {},
	userMutes: new Set(),
	incomingCall: null,
	handledCallChannels: new Set(),
	ping: null,

	joinVoice: (channelId) =>
		set((state) => {
			const handled = new Set(state.handledCallChannels);
			handled.add(channelId);
			return {
				activeChannelId: channelId,
				isActive: true,
				callStatus: 'connecting',
				incomingCall: null,
				handledCallChannels: handled,
				ping: null,
				logs: [`[${new Date().toLocaleTimeString()}] Joining channel ${channelId}...`],
			};
		}),

	leaveVoice: () =>
		set((state) => {
			let nextParticipants = state.participants;
			const handled = new Set(state.handledCallChannels);
			if (state.activeChannelId) {
				nextParticipants = { ...state.participants };
				delete nextParticipants[state.activeChannelId];
				handled.add(state.activeChannelId);
			}
			return {
				activeChannelId: null,
				isActive: false,
				callStatus: 'idle',
				isVideoEnabled: false,
				isScreenSharing: false,
				localStream: null,
				localScreenStream: null,
				remoteStreams: {},
				remoteScreenStreams: {},
				participantTrackStates: {},
				activePresenterId: null,
				speakingUsers: new Set<string>(),
				participants: nextParticipants,
				handledCallChannels: handled,
				incomingCall: null,
				ping: null,
			};
		}),

	setIncomingCall: (call) => set({ incomingCall: call }),
	dismissIncomingCall: () =>
		set((state) => {
			if (!state.incomingCall) return { incomingCall: null };
			const handled = new Set(state.handledCallChannels);
			handled.add(state.incomingCall.channelId);
			return { incomingCall: null, handledCallChannels: handled };
		}),
	markCallHandled: (channelId) =>
		set((state) => {
			const handled = new Set(state.handledCallChannels);
			handled.add(channelId);
			return {
				handledCallChannels: handled,
				incomingCall: state.incomingCall?.channelId === channelId ? null : state.incomingCall,
			};
		}),
	resetHandledCall: (channelId) =>
		set((state) => {
			if (!state.handledCallChannels.has(channelId)) return state;
			const handled = new Set(state.handledCallChannels);
			handled.delete(channelId);
			return { handledCallChannels: handled };
		}),
	setPing: (ping) => set({ ping }),

	updateParticipants: (channelId, users) =>
		set((state) => ({
			participants: { ...state.participants, [channelId]: users },
		})),

	setRemoteStream: (userId, stream) =>
		set((state) => ({
			remoteStreams: { ...state.remoteStreams, [userId]: stream },
		})),

	setRemoteScreenStream: (userId, stream) =>
		set((state) => {
			if (!stream) {
				const next = { ...state.remoteScreenStreams };
				delete next[userId];
				return {
					remoteScreenStreams: next,
					activePresenterId: state.activePresenterId === userId ? null : state.activePresenterId,
				};
			}
			return {
				remoteScreenStreams: { ...state.remoteScreenStreams, [userId]: stream },
				activePresenterId: userId,
			};
		}),

	removeRemoteStream: (userId) =>
		set((state) => {
			const nextStreams = { ...state.remoteStreams };
			const nextScreenStreams = { ...state.remoteScreenStreams };
			const nextTrackStates = { ...state.participantTrackStates };
			delete nextStreams[userId];
			delete nextScreenStreams[userId];
			delete nextTrackStates[userId];

			return {
				remoteStreams: nextStreams,
				remoteScreenStreams: nextScreenStreams,
				participantTrackStates: nextTrackStates,
				activePresenterId: state.activePresenterId === userId ? null : state.activePresenterId,
			};
		}),

	setTrackState: (userId, kind, enabled) =>
		set((state) => {
			const current = state.participantTrackStates[userId] || {
				audio: false,
				video: false,
				screen: false,
			};
			const nextPresenter =
				kind === 'screen'
					? enabled
						? userId
						: state.activePresenterId === userId
						? null
						: state.activePresenterId
					: state.activePresenterId;
			return {
				participantTrackStates: {
					...state.participantTrackStates,
					[userId]: { ...current, [kind]: enabled },
				},
				activePresenterId: nextPresenter,
			};
		}),

	setPreferredCameraId: (id) => set({ preferredCameraId: id }),
	setActivePresenterId: (id) => set({ activePresenterId: id }),

	setUserVolume: (userId, volume) =>
		set((state) => ({
			userVolumes: { ...state.userVolumes, [userId]: volume },
		})),

	toggleUserMute: (userId) =>
		set((state) => {
			const next = new Set(state.userMutes);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return { userMutes: next };
		}),

	addLog: (message) =>
		set((state) => {
			console.log(`[VoiceStore Log] ${message}`);
			return {
				logs: [...state.logs.slice(-49), `[${new Date().toLocaleTimeString()}] ${message}`],
			};
		}),

	clearLogs: () => set({ logs: [] }),

	_setInternalState: (newState) => set(newState),
}));
