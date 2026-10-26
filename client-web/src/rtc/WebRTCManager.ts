/**
 * WebRTC Client Manager for Cove group calling.
 *
 * Implements the dual-PeerConnection architecture matching backend/internal/rtc:
 * - publishPC: sends local microphone, camera, and screen share tracks to the SFU
 * - subscribePC: receives forwarded audio/video/screen tracks from all room peers
 *
 * Signaling is routed entirely over the existing authenticated WebSocket hub (ws.ts).
 */

import {
	onWS,
	wsSendCallJoin,
	wsSendCallLeave,
	wsSendCallPublishOffer,
	wsSendCallSubscribeAnswer,
	wsSendCallICECandidate,
	wsSendCallTrackState,
	wsSendCallRequestKeyframe,
	type CallJoinedPayload,
	type CallSDPPayload,
	type CallICECandidatePayload,
	type CallTrackStatePayload,
	type CallParticipantEventPayload,
	type CallErrorPayload,
} from '@/ws';
import { useVoiceStore, type ScreenShareSettings } from '@/store/voiceStore';
import { useAppStore } from '@/store/app.slice';
import { useAuthStore } from '@/store/store';
import { toast } from 'sonner';
import i18n from '@/i18n';

/** How long to wait for the server's call_joined before giving up. */
const CONNECT_TIMEOUT_MS = 12_000;

export interface WebRTCOptions {
	video?: boolean;
}

export class WebRTCManager {
	private channelId: string | null = null;
	private publishPC: RTCPeerConnection | null = null;
	private subscribePC: RTCPeerConnection | null = null;

	private localAudioTrack: MediaStreamTrack | null = null;
	private localVideoTrack: MediaStreamTrack | null = null;
	private localScreenTrack: MediaStreamTrack | null = null;
	private localScreenAudioTrack: MediaStreamTrack | null = null;

	private localAudioSender: RTCRtpSender | null = null;
	private localVideoSender: RTCRtpSender | null = null;
	private localScreenSender: RTCRtpSender | null = null;
	private localScreenAudioSender: RTCRtpSender | null = null;

	private audioContext: AudioContext | null = null;
	private localAnalyser: AnalyserNode | null = null;
	private remoteAudioNodes: Map<string, { gainNode: GainNode; audio: HTMLAudioElement }> = new Map();
	private remoteScreenAudioNodes: Map<string, { gainNode: GainNode; audio: HTMLAudioElement }> = new Map();
	private remoteAnalysers: Map<string, AnalyserNode> = new Map();
	private speakerLastSpoke: Map<string, number> = new Map();
	private vadInterval: ReturnType<typeof setInterval> | null = null;
	private pingInterval: ReturnType<typeof setInterval> | null = null;

	private unsubs: Array<() => void> = [];
	private pendingPublishCandidates: RTCIceCandidateInit[] = [];
	private pendingSubscribeCandidates: RTCIceCandidateInit[] = [];
	private pendingSubscribeOffer: RTCSessionDescriptionInit | null = null;

	private isConnecting = false;
	/** Guards camera/mic toggles against double-clicks while getUserMedia or a renegotiation is in flight. */
	private deviceBusy = false;
	/** Screen track ids whose msid must be rewritten to `screen` in every publish offer, not just the one that added them. */
	private screenTrackIds: string[] = [];
	/** A publish offer was requested while a previous offer/answer round was still open. */
	private renegotiationPending = false;
	/** Fires when the server never answers call_join, so the UI cannot sit in "connecting" forever. */
	private connectTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Ensures the AudioContext is initialized within a user gesture.
	 */
	private initAudioContext(): AudioContext | null {
		if (this.audioContext) return this.audioContext;
		const AudioCtx =
			typeof window !== 'undefined'
				? window.AudioContext ||
				  (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
				: null;
		if (typeof AudioCtx === 'function') {
			try {
				this.audioContext = new AudioCtx();
				if (this.audioContext.state === 'suspended') {
					this.audioContext.resume().catch(() => {});
				}
			} catch {
				/* AudioContext may be restricted in some environments */
			}
		}
		return this.audioContext;
	}

	/**
	 * Connect to an active call or start a new call on the given channel.
	 *
	 * @param channelId - The channel ID for the call
	 * @param options - Optional configuration (e.g., enable camera immediately)
	 */
	public async join(channelId: string, options?: WebRTCOptions): Promise<void> {
		if (this.channelId === channelId && (this.isConnecting || this.publishPC)) {
			return;
		}

		// Switching calls (or retrying after a stuck connect) must tear the old one down first.
		if (this.channelId) {
			await this.leave();
		}

		// Initialize AudioContext immediately on user gesture
		this.initAudioContext();

		this.channelId = channelId;
		this.isConnecting = true;
		this.pendingSubscribeOffer = null;

		const store = useVoiceStore.getState();
		const currentUserId = useAuthStore.getState().user?.id;
		const existingMembers = store.participants[channelId] || [];
		const initialMembers = currentUserId && !existingMembers.includes(currentUserId)
			? [...existingMembers, currentUserId]
			: existingMembers;

		store._setInternalState({
			activeChannelId: channelId,
			isActive: true,
			callStatus: 'connecting',
		});
		if (initialMembers.length > 0) {
			store.updateParticipants(channelId, initialMembers);
		}
		store.addLog(`[RTC] Joining call in channel ${channelId}...`);

		this.setupSignalingListeners(channelId, options);
		wsSendCallJoin(channelId);
		this.clearConnectTimer();
		this.connectTimer = setTimeout(() => {
			if (this.channelId === channelId && !this.publishPC) {
				useVoiceStore.getState().addLog('[RTC] call_join was never answered');
				toast.error(i18n.t('call.connectFailed'));
				void this.leave();
			}
		}, CONNECT_TIMEOUT_MS);
	}

	/**
	 * Leave the active call and release all media devices and peer connections.
	 */
	public async leave(): Promise<void> {
		if (!this.channelId) return;

		const prevChannelId = this.channelId;
		this.clearConnectTimer();
		this.channelId = null;
		this.isConnecting = false;
		this.deviceBusy = false;
		this.screenTrackIds = [];
		this.renegotiationPending = false;
		this.pendingSubscribeOffer = null;

		wsSendCallLeave(prevChannelId);

		// Clean up signaling listeners
		for (const unsub of this.unsubs) {
			unsub();
		}
		this.unsubs = [];

		// Stop and release local tracks
		this.stopLocalTracks();

		// Close PeerConnections
		if (this.publishPC) {
			try {
				this.publishPC.close();
			} catch {
				/* ignore */
			}
			this.publishPC = null;
		}
		if (this.subscribePC) {
			try {
				this.subscribePC.close();
			} catch {
				/* ignore */
			}
			this.subscribePC = null;
		}
		this.stopPingMonitoring();

		// Close audio context and remote audio nodes
		this.cleanupAudio();

		this.pendingPublishCandidates = [];
		this.pendingSubscribeCandidates = [];

		const store = useVoiceStore.getState();
		store.leaveVoice();
		store.addLog(`[RTC] Left call in channel ${prevChannelId}`);
	}

	/**
	 * Toggle local microphone mute state. If the microphone could not be opened when joining (permission denied,
	 * device plugged in later) this retries the capture so the button is never a silent no-op.
	 */
	public async toggleMute(): Promise<void> {
		if (!this.channelId || !this.publishPC) return;
		const store = useVoiceStore.getState();
		const nextMuted = !store.isMuted;

		if (!this.localAudioTrack) {
			if (nextMuted) {
				store._setInternalState({ isMuted: true });
				return;
			}
			if (this.deviceBusy) return;
			this.deviceBusy = true;
			try {
				const ok = await this.acquireMicrophone(false);
				if (!ok) return;
				store._setInternalState({ isMuted: false });
				wsSendCallTrackState(this.channelId, 'audio', true);
				await this.renegotiatePublish();
			} finally {
				this.deviceBusy = false;
			}
			return;
		}

		this.localAudioTrack.enabled = !nextMuted;
		store._setInternalState({ isMuted: nextMuted });
		wsSendCallTrackState(this.channelId, 'audio', !nextMuted);
	}

	/**
	 * Open the microphone and attach it to the publish connection.
	 *
	 * @param muted - initial mute state of the new track
	 * @returns whether a track is now being sent; failures are surfaced as a toast
	 */
	private async acquireMicrophone(muted: boolean): Promise<boolean> {
		if (!this.publishPC) return false;
		const preferredMic = useAppStore.getState().preferredMicId;
		const base: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
		try {
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: preferredMic && preferredMic !== 'default' ? { ...base, deviceId: { exact: preferredMic } } : base,
				});
			} catch (err) {
				// A remembered device that is unplugged must not block the default microphone.
				if (err instanceof DOMException && err.name === 'OverconstrainedError') {
					stream = await navigator.mediaDevices.getUserMedia({ audio: base });
				} else {
					throw err;
				}
			}
			const track = stream.getAudioTracks()[0];
			if (!track) return false;
			this.localAudioTrack = track;
			track.enabled = !muted;
			this.localAudioSender = this.publishPC.addTrack(track, this.createLocalStream());
			this.setupLocalAnalyser(track);
			useVoiceStore.getState()._setInternalState({ localStream: this.createLocalStream() });
			return true;
		} catch (err) {
			useVoiceStore.getState().addLog(`[RTC] Failed to acquire microphone: ${err}`);
			toast.error(i18n.t('call.micError'));
			return false;
		}
	}

	/**
	 * Toggle local deafen state (mute all incoming call audio).
	 */
	public toggleDeafen(): void {
		const currentDeafened = useVoiceStore.getState().isDeafened;
		const nextDeafened = !currentDeafened;
		useVoiceStore.getState()._setInternalState({ isDeafened: nextDeafened });

		const volumes = useVoiceStore.getState();
		this.remoteAudioNodes.forEach(({ gainNode }, userId) => {
			gainNode.gain.value = nextDeafened || volumes.userMutes.has(userId) ? 0 : (volumes.userVolumes[userId] ?? 1);
		});
		this.remoteScreenAudioNodes.forEach(({ gainNode }, userId) => {
			gainNode.gain.value =
				nextDeafened || volumes.screenShareMutes[userId] ? 0 : (volumes.screenShareVolumes[userId] ?? 1);
		});
	}

	/**
	 * Toggle local camera video stream.
	 */
	public async toggleVideo(): Promise<void> {
		if (!this.publishPC || !this.channelId || this.deviceBusy) return;
		this.deviceBusy = true;
		try {
			if (useVoiceStore.getState().isVideoEnabled) {
				await this.stopCamera();
			} else {
				await this.startCamera();
			}
		} finally {
			this.deviceBusy = false;
		}
	}

	private async stopCamera(): Promise<void> {
		if (!this.publishPC || !this.channelId) return;
		if (this.localVideoSender) {
			try {
				this.publishPC.removeTrack(this.localVideoSender);
			} catch {
				/* ignore */
			}
			this.localVideoSender = null;
		}
		if (this.localVideoTrack) {
			this.localVideoTrack.stop();
			this.localVideoTrack = null;
		}
		useVoiceStore.getState()._setInternalState({
			isVideoEnabled: false,
			localStream: this.createLocalStream(),
		});
		wsSendCallTrackState(this.channelId, 'video', false);
		await this.renegotiatePublish();
	}

	private async startCamera(): Promise<void> {
		if (!this.publishPC || !this.channelId) return;
		const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
		const preferredCamera = useVoiceStore.getState().preferredCameraId;
		try {
			let videoStream: MediaStream;
			try {
				videoStream = await navigator.mediaDevices.getUserMedia({
					video: preferredCamera ? { ...size, deviceId: { exact: preferredCamera } } : size,
				});
			} catch (err) {
				if (preferredCamera && err instanceof DOMException && err.name === 'OverconstrainedError') {
					videoStream = await navigator.mediaDevices.getUserMedia({ video: size });
				} else {
					throw err;
				}
			}
			const track = videoStream.getVideoTracks()[0];
			if (!track) return;
			// A camera unplugged mid-call ends the track; keep the UI state truthful.
			track.onended = () => {
				if (this.localVideoTrack === track) void this.stopCamera();
			};

			this.localVideoTrack = track;
			const stream = this.createLocalStream();
			this.localVideoSender = this.publishPC.addTrack(track, stream);

			useVoiceStore.getState()._setInternalState({ isVideoEnabled: true, localStream: stream });
			wsSendCallTrackState(this.channelId, 'video', true);
			await this.renegotiatePublish();
		} catch (err) {
			useVoiceStore.getState().addLog(`[RTC] Failed to access camera: ${err}`);
			toast.error(i18n.t('call.cameraError'));
		}
	}

	/**
	 * Request an immediate keyframe from video publishers (or all publishers if not specified).
	 */
	public requestKeyframe(targetUserId?: string): void {
		if (this.channelId) {
			wsSendCallRequestKeyframe(this.channelId, targetUserId);
		}
	}

	/**
	 * Toggle local screen sharing stream with configurable quality and constraints.
	 */
	public async toggleScreenShare(customSettings?: Partial<ScreenShareSettings>): Promise<void> {
		if (!this.publishPC || !this.channelId) return;
		const isCurrentlySharing = useVoiceStore.getState().isScreenSharing;

		if (isCurrentlySharing) {
			// Stop screen share
			if (this.localScreenSender && this.publishPC) {
				try {
					this.publishPC.removeTrack(this.localScreenSender);
				} catch {
					/* ignore */
				}
				this.localScreenSender = null;
			}
			if (this.localScreenAudioSender && this.publishPC) {
				try {
					this.publishPC.removeTrack(this.localScreenAudioSender);
				} catch {
					/* ignore */
				}
				this.localScreenAudioSender = null;
			}
			if (this.localScreenTrack) {
				this.localScreenTrack.stop();
				this.localScreenTrack = null;
			}
			if (this.localScreenAudioTrack) {
				this.localScreenAudioTrack.stop();
				this.localScreenAudioTrack = null;
			}

			useVoiceStore.getState()._setInternalState({
				isScreenSharing: false,
				localScreenStream: null,
				spotlightStreamId:
					useVoiceStore.getState().spotlightStreamId === 'local'
						? null
						: useVoiceStore.getState().spotlightStreamId,
			});
			wsSendCallTrackState(this.channelId, 'screen', false);
			this.screenTrackIds = [];
			await this.renegotiatePublish();
		} else {
			// Start screen share with configurable settings
			try {
				if (customSettings) {
					useVoiceStore.getState().setScreenShareSettings(customSettings);
				}
				const settings = useVoiceStore.getState().screenShareSettings;

				let widthConstraint: ConstrainULong | undefined;
				let heightConstraint: ConstrainULong | undefined;
				if (settings.resolution === '720p') {
					widthConstraint = { max: 1280 };
					heightConstraint = { max: 720 };
				} else if (settings.resolution === '1080p') {
					widthConstraint = { max: 1920 };
					heightConstraint = { max: 1080 };
				} else if (settings.resolution === '1440p') {
					widthConstraint = { max: 2560 };
					heightConstraint = { max: 1440 };
				}

				let aspectRatioConstraint: ConstrainDouble | undefined;
				if (settings.aspectRatio === '16/9') {
					aspectRatioConstraint = 16 / 9;
				} else if (settings.aspectRatio === '4/3') {
					aspectRatioConstraint = 4 / 3;
				}

				const videoConstraints: MediaTrackConstraints = {
					frameRate: { max: settings.frameRate, ideal: settings.frameRate },
				};
				if (widthConstraint) videoConstraints.width = widthConstraint;
				if (heightConstraint) videoConstraints.height = heightConstraint;
				if (aspectRatioConstraint) videoConstraints.aspectRatio = aspectRatioConstraint;

				const displayStream = await navigator.mediaDevices.getDisplayMedia({
					video: videoConstraints,
					audio: settings.includeAudio
						? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
						: false,
				});
				const track = displayStream.getVideoTracks()[0];
				if (!track) return;

				this.localScreenTrack = track;
				try {
					track.contentHint = settings.contentHint || 'detail';
				} catch {
					/* ignore */
				}

				track.onended = () => {
					// Fired by the browser's own "Stop sharing" bar; ignore it if we already stopped.
					if (this.localScreenTrack === track) void this.toggleScreenShare();
				};

				this.localScreenSender = this.publishPC.addTrack(track, displayStream);

				// Capture and add screen audio track if present
				let screenAudioTrackId: string | undefined;
				const audioTracks = displayStream.getAudioTracks();
				if (audioTracks.length > 0) {
					this.localScreenAudioTrack = audioTracks[0];
					screenAudioTrackId = audioTracks[0].id;
					this.localScreenAudioSender = this.publishPC.addTrack(audioTracks[0], displayStream);
				}

				useVoiceStore.getState()._setInternalState({
					isScreenSharing: true,
					localScreenStream: displayStream,
					spotlightStreamId: 'local',
				});
				wsSendCallTrackState(this.channelId, 'screen', true, track.id, displayStream.id);
				this.screenTrackIds = [track.id, ...(screenAudioTrackId ? [screenAudioTrackId] : [])];
				await this.renegotiatePublish();
			} catch (err) {
				useVoiceStore.getState().addLog(`[RTC] Screen sharing cancelled or failed: ${err}`);
				if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
					toast.error(i18n.t('call.screenError'));
				}
			}
		}
	}

	/**
	 * Apply new screen share constraints on the fly to an active screen share track.
	 */
	public async applyScreenShareConstraints(newSettings: Partial<ScreenShareSettings>): Promise<void> {
		useVoiceStore.getState().setScreenShareSettings(newSettings);
		const settings = useVoiceStore.getState().screenShareSettings;
		if (!this.localScreenTrack) return;

		let widthConstraint: ConstrainULong | undefined;
		let heightConstraint: ConstrainULong | undefined;
		if (settings.resolution === '720p') {
			widthConstraint = { max: 1280 };
			heightConstraint = { max: 720 };
		} else if (settings.resolution === '1080p') {
			widthConstraint = { max: 1920 };
			heightConstraint = { max: 1080 };
		} else if (settings.resolution === '1440p') {
			widthConstraint = { max: 2560 };
			heightConstraint = { max: 1440 };
		}

		let aspectRatioConstraint: ConstrainDouble | undefined;
		if (settings.aspectRatio === '16/9') {
			aspectRatioConstraint = 16 / 9;
		} else if (settings.aspectRatio === '4/3') {
			aspectRatioConstraint = 4 / 3;
		}

		const constraints: MediaTrackConstraints = {
			frameRate: { max: settings.frameRate, ideal: settings.frameRate },
		};
		if (widthConstraint) constraints.width = widthConstraint;
		if (heightConstraint) constraints.height = heightConstraint;
		if (aspectRatioConstraint) constraints.aspectRatio = aspectRatioConstraint;

		try {
			await this.localScreenTrack.applyConstraints(constraints);
			this.localScreenTrack.contentHint = settings.contentHint || 'detail';
			useVoiceStore.getState().addLog(`[RTC] Screen share constraints updated: ${settings.resolution} @ ${settings.frameRate}fps`);
		} catch (err) {
			useVoiceStore.getState().addLog(`[RTC] Failed to apply screen constraints: ${err}`);
		}
	}

	/**
	 * Update the output volume for a specific remote screen share stream.
	 */
	public setScreenShareVolume(userId: string, volume: number): void {
		useVoiceStore.getState().setScreenShareVolume(userId, volume);
		const node = this.remoteScreenAudioNodes.get(userId);
		if (node) {
			const isMuted = !!useVoiceStore.getState().screenShareMutes[userId] || useVoiceStore.getState().isDeafened;
			node.gainNode.gain.value = isMuted ? 0 : volume;
		}
	}

	/**
	 * Toggle mute for a specific remote screen share stream.
	 */
	public toggleScreenShareMute(userId: string): void {
		useVoiceStore.getState().toggleScreenShareMute(userId);
		const isMuted = !!useVoiceStore.getState().screenShareMutes[userId] || useVoiceStore.getState().isDeafened;
		const volume = useVoiceStore.getState().screenShareVolumes[userId] ?? 1;
		const node = this.remoteScreenAudioNodes.get(userId);
		if (node) {
			node.gainNode.gain.value = isMuted ? 0 : volume;
		}
	}

	/**
	 * Update the output volume for a specific remote user.
	 *
	 * @param userId - Target user ID
	 * @param volume - Volume scale (0.0 to 2.0)
	 */
	public setParticipantVolume(userId: string, volume: number): void {
		useVoiceStore.getState().setUserVolume(userId, volume);
		const node = this.remoteAudioNodes.get(userId);
		if (node) {
			const isMutedLocally = useVoiceStore.getState().userMutes.has(userId);
			const isDeafened = useVoiceStore.getState().isDeafened;
			node.gainNode.gain.value = isMutedLocally || isDeafened ? 0 : volume;
		}
	}

	/**
	 * Toggle local mute for a specific remote user.
	 *
	 * @param userId - Target user ID
	 */
	public toggleParticipantMute(userId: string): void {
		const store = useVoiceStore.getState();
		store.toggleUserMute(userId);

		const isMutedNow = useVoiceStore.getState().userMutes.has(userId);
		const userVol = useVoiceStore.getState().userVolumes[userId] ?? 1;
		const isDeafened = useVoiceStore.getState().isDeafened;

		const node = this.remoteAudioNodes.get(userId);
		if (node) {
			node.gainNode.gain.value = isMutedNow || isDeafened ? 0 : userVol;
		}
	}

	// ── Private Setup & Negotiation ──────────────────────────────────────────

	private setupSignalingListeners(_channelId: string, options?: WebRTCOptions): void {
		this.unsubs.push(
			onWS('call_joined', async (rawPayload: unknown) => {
				const payload = rawPayload as CallJoinedPayload;
				if (payload.channel_id !== this.channelId) return;
				try {
					await this.handleCallJoined(payload, options);
				} catch (err) {
					// Never fail silently: a half-built call would leave dead buttons behind.
					useVoiceStore.getState().addLog(`[RTC] Failed to set up call: ${err}`);
					toast.error(i18n.t('call.connectFailed'));
					void this.leave();
				}
			}),

			onWS('call_publish_answer', async (rawPayload: unknown) => {
				const payload = rawPayload as CallSDPPayload;
				if (payload.channel_id !== this.channelId || !this.publishPC) return;
				try {
					await this.publishPC.setRemoteDescription(payload.sdp);
					this.flushPendingCandidates(this.publishPC, this.pendingPublishCandidates);
				} catch (err) {
					useVoiceStore.getState().addLog(`[RTC] setRemoteDescription error on publishPC: ${err}`);
				}
				// Changes requested while this offer was in flight go out now that the round is closed.
				if (this.renegotiationPending) {
					this.renegotiationPending = false;
					await this.renegotiatePublish();
				}
			}),

			onWS('call_subscribe_offer', async (rawPayload: unknown) => {
				const payload = rawPayload as CallSDPPayload;
				if (payload.channel_id !== this.channelId) return;

				if (!this.subscribePC) {
					useVoiceStore.getState().addLog('[RTC] Buffering early subscribe offer before subscribePC is ready');
					this.pendingSubscribeOffer = payload.sdp;
					return;
				}

				await this.handleSubscribeOffer(payload.sdp);
			}),

			onWS('call_ice_candidate', async (rawPayload: unknown) => {
				const payload = rawPayload as CallICECandidatePayload;
				if (payload.channel_id !== this.channelId) return;
				const pc = payload.target === 'publish' ? this.publishPC : this.subscribePC;
				const queue = payload.target === 'publish' ? this.pendingPublishCandidates : this.pendingSubscribeCandidates;

				if (!pc || !pc.remoteDescription) {
					queue.push(payload.candidate);
					return;
				}

				try {
					await pc.addIceCandidate(payload.candidate);
				} catch {
					/* ignore */
				}
			}),

			onWS('call_track_state', (rawPayload: unknown) => {
				const payload = rawPayload as CallTrackStatePayload;
				if (payload.channel_id !== this.channelId || !payload.user_id) return;
				useVoiceStore.getState().setTrackState(payload.user_id, payload.kind, payload.enabled);
				if (payload.kind === 'screen' && payload.enabled) {
					this.requestKeyframe(payload.user_id);
					setTimeout(() => this.requestKeyframe(payload.user_id), 300);
				}
			}),

			onWS('call_participant_joined', (rawPayload: unknown) => {
				const payload = rawPayload as CallParticipantEventPayload;
				if (payload.channel_id !== this.channelId) return;
				const store = useVoiceStore.getState();
				const current = store.participants[this.channelId] || [];
				if (!current.includes(payload.user.user_id)) {
					store.updateParticipants(this.channelId, [...current, payload.user.user_id]);
				}
				if (payload.user.track_states) {
					for (const [kind, enabled] of Object.entries(payload.user.track_states)) {
						store.setTrackState(payload.user.user_id, kind as 'audio' | 'video' | 'screen', enabled);
					}
				}
			}),

			onWS('call_participant_left', (rawPayload: unknown) => {
				const payload = rawPayload as CallParticipantEventPayload;
				if (payload.channel_id !== this.channelId) return;
				const store = useVoiceStore.getState();
				const current = store.participants[this.channelId] || [];
				store.updateParticipants(this.channelId, current.filter(id => id !== payload.user.user_id));
				store.removeRemoteStream(payload.user.user_id);
				this.removeRemoteAudio(payload.user.user_id);
			}),

			onWS('call_error', (rawPayload: unknown) => {
				const payload = rawPayload as CallErrorPayload;
				useVoiceStore.getState().addLog(`[RTC] Server error: ${payload.error}`);
				if (payload.error.includes('not a member') || payload.error.includes('call is full')) {
					this.leave();
				}
			}),
		);
	}

	private clearConnectTimer(): void {
		if (this.connectTimer) {
			clearTimeout(this.connectTimer);
			this.connectTimer = null;
		}
	}

	private async handleCallJoined(payload: CallJoinedPayload, options?: WebRTCOptions): Promise<void> {
		this.clearConnectTimer();
		const store = useVoiceStore.getState();
		// The server serialises an empty list as null when TURN is not configured; indexing it used to throw here,
		// which silently aborted the join and left no PeerConnection (every call button then did nothing).
		const iceServers = payload.ice_servers ?? [];
		const participants = payload.participants ?? [];
		const rtcConfig: RTCConfiguration = { iceServers };

		store.addLog(`[RTC] Received call_joined. Initializing WebRTC with ${iceServers.length} ICE server(s)...`);

		// Build participant roster immediately
		const participantIds = participants.map(p => p.user_id);
		const currentUserId = useAuthStore.getState().user?.id;
		if (currentUserId && !participantIds.includes(currentUserId)) {
			participantIds.push(currentUserId);
		}
		store.updateParticipants(payload.channel_id, participantIds);

		for (const p of participants) {
			if (p.track_states) {
				for (const [kind, enabled] of Object.entries(p.track_states)) {
					store.setTrackState(p.user_id, kind as 'audio' | 'video' | 'screen', enabled);
				}
			} else {
				store.setTrackState(p.user_id, 'audio', true);
				store.setTrackState(p.user_id, 'video', false);
				store.setTrackState(p.user_id, 'screen', false);
			}
		}

		// Initialize PeerConnections synchronously right away to avoid race conditions with early subscribe offers
		this.publishPC = new RTCPeerConnection(rtcConfig);
		this.subscribePC = new RTCPeerConnection(rtcConfig);

		// Wire connection state changes for ping monitoring
		const onConnChange = () => {
			if (
				this.publishPC?.connectionState === 'connected' ||
				this.subscribePC?.connectionState === 'connected'
			) {
				this.startPingMonitoring();
			}
		};
		this.publishPC.onconnectionstatechange = onConnChange;
		this.subscribePC.onconnectionstatechange = onConnChange;

		// Wire ICE candidates
		this.publishPC.onicecandidate = (e) => {
			if (e.candidate && this.channelId) {
				wsSendCallICECandidate(this.channelId, 'publish', e.candidate.toJSON());
			}
		};
		this.subscribePC.onicecandidate = (e) => {
			if (e.candidate && this.channelId) {
				wsSendCallICECandidate(this.channelId, 'subscribe', e.candidate.toJSON());
			}
		};

		// Wire subscribePC incoming tracks
		this.subscribePC.ontrack = (event) => {
			const { track, streams } = event;
			const targetStream = streams[0] || new MediaStream([track]);
			const streamId = targetStream.id || '';

			store.addLog(`[RTC] Inbound track: kind=${track.kind}, streamId=${streamId}`);

			const isScreen = streamId.endsWith(':screen') || streamId === 'screen' || streamId.includes(':screen');

			if (isScreen) {
				let publisherId = '';
				if (streamId.includes(':screen')) {
					publisherId = streamId.split(':screen')[0];
				} else if (streamId.endsWith(':screen')) {
					publisherId = streamId.slice(0, -':screen'.length);
				}
				// If publisherId is empty or literal 'screen', resolve from track states or participants
				if (!publisherId || publisherId === 'screen') {
					const trackStates = store.participantTrackStates;
					const currentUid = useAuthStore.getState().user?.id;
					const screenPublisher = Object.keys(trackStates).find(
						(uid) => uid !== currentUid && trackStates[uid]?.screen
					);
					if (screenPublisher) {
						publisherId = screenPublisher;
					} else {
						publisherId = store.activePresenterId || Object.keys(store.remoteStreams)[0] || 'screen';
					}
				}

				if (track.kind === 'video') {
					store.setRemoteScreenStream(publisherId, targetStream);
					store.setTrackState(publisherId, 'screen', true);
					// Request an immediate keyframe so the remote video begins decoding without delay
					this.requestKeyframe(publisherId);
					setTimeout(() => this.requestKeyframe(publisherId), 300);
				} else if (track.kind === 'audio') {
					this.attachRemoteScreenAudio(publisherId, track);
				}
			} else if (streamId) {
				const publisherId = streamId;
				store.setRemoteStream(publisherId, targetStream);

				if (track.kind === 'audio') {
					this.attachRemoteAudio(publisherId, track);
				} else if (track.kind === 'video') {
					this.requestKeyframe(publisherId);
					setTimeout(() => this.requestKeyframe(publisherId), 300);
				}
			}
		};

		// If a subscribe offer arrived before subscribePC was initialized, process it immediately!
		if (this.pendingSubscribeOffer) {
			const bufferedOffer = this.pendingSubscribeOffer;
			this.pendingSubscribeOffer = null;
			await this.handleSubscribeOffer(bufferedOffer);
		}

		// Acquire local microphone (a failure leaves the call listen-only; the mic button retries)
		const micOk = await this.acquireMicrophone(store.isMuted);
		if (!micOk) {
			store._setInternalState({ isMuted: true });
		}

		// Optionally acquire local video if requested
		if (options?.video) {
			try {
				const preferredCamera = store.preferredCameraId;
				const videoConstraints: MediaTrackConstraints = preferredCamera
					? { deviceId: { exact: preferredCamera }, width: { ideal: 1280 }, height: { ideal: 720 } }
					: { width: { ideal: 1280 }, height: { ideal: 720 } };

				const videoStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
				const videoTrack = videoStream.getVideoTracks()[0];
				if (videoTrack) {
					this.localVideoTrack = videoTrack;
					this.localVideoSender = this.publishPC.addTrack(videoTrack, this.createLocalStream());
					store._setInternalState({ isVideoEnabled: true });
				}
			} catch (err) {
				store.addLog(`[RTC] Failed to acquire camera: ${err}`);
			}
		}

		store._setInternalState({
			localStream: this.createLocalStream(),
			callStatus: 'connected',
		});

		// Start VAD loop with zero-lag onset and smooth decay
		this.startVAD();

		// Initial publish offer negotiation
		await this.renegotiatePublish();

		this.isConnecting = false;

		// Broadcast initial track states
		wsSendCallTrackState(payload.channel_id, 'audio', !useVoiceStore.getState().isMuted);
		if (this.localVideoTrack) {
			wsSendCallTrackState(payload.channel_id, 'video', true);
		}
	}

	private async handleSubscribeOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
		if (!this.subscribePC || !this.channelId) return;
		try {
			await this.subscribePC.setRemoteDescription(sdp);
			this.flushPendingCandidates(this.subscribePC, this.pendingSubscribeCandidates);

			const answer = await this.subscribePC.createAnswer();
			await this.subscribePC.setLocalDescription(answer);

			wsSendCallSubscribeAnswer(this.channelId, answer);
		} catch (err) {
			useVoiceStore.getState().addLog(`[RTC] Error handling subscribe offer: ${err}`);
		}
	}

	/**
	 * Send a fresh publish offer. Offers are strictly one-at-a-time: while a previous offer is waiting for its answer
	 * the request is remembered and replayed from the `call_publish_answer` handler, otherwise two quick toggles
	 * (camera then screen) race and the second setLocalDescription clobbers the first.
	 */
	private async renegotiatePublish(): Promise<void> {
		if (!this.publishPC || !this.channelId) return;
		if (this.publishPC.signalingState !== 'stable') {
			this.renegotiationPending = true;
			return;
		}

		try {
			const offer = await this.publishPC.createOffer();
			// Set local description with the browser's pristine offer first to prevent WebRTC rejection
			await this.publishPC.setLocalDescription(offer);

			let finalSdp = offer.sdp || '';

			// Screen tracks must be tagged msid `screen` in EVERY offer while they exist (backend classifyTrack),
			// not only in the offer that added them, or a later camera toggle would reclassify the screen as camera.
			if (this.screenTrackIds.length > 0 && finalSdp) {
				finalSdp = finalSdp
					.split('\r\n')
					.map((line) => {
						for (const id of this.screenTrackIds) {
							if (line.startsWith('a=msid:') && line.includes(id)) {
								return `a=msid:screen ${id}`;
							}
						}
						return line;
					})
					.join('\r\n');
			}

			wsSendCallPublishOffer(this.channelId, { type: offer.type, sdp: finalSdp });
		} catch (err) {
			useVoiceStore.getState().addLog(`[RTC] Renegotiate publish error: ${err}`);
		}
	}

	private createLocalStream(): MediaStream {
		const tracks: MediaStreamTrack[] = [];
		if (this.localAudioTrack) tracks.push(this.localAudioTrack);
		if (this.localVideoTrack) tracks.push(this.localVideoTrack);
		return new MediaStream(tracks);
	}

	private flushPendingCandidates(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]): void {
		const toFlush = [...queue];
		queue.length = 0;
		for (const cand of toFlush) {
			pc.addIceCandidate(cand).catch(() => {});
		}
	}

	private attachRemoteScreenAudio(userId: string, track: MediaStreamTrack): void {
		const ctx = this.initAudioContext();
		this.removeRemoteScreenAudio(userId);

		const mediaStream = new MediaStream([track]);
		const audio = new Audio();
		audio.srcObject = mediaStream;
		audio.muted = true; // Muted to avoid duplicate playback alongside Web Audio API
		audio.autoplay = true;

		if (!ctx) return;

		try {
			const source = ctx.createMediaStreamSource(mediaStream);
			const gainNode = ctx.createGain();
			const store = useVoiceStore.getState();
			const volume = store.screenShareVolumes[userId] ?? 1;
			const isMuted = !!store.screenShareMutes[userId] || store.isDeafened;

			gainNode.gain.value = isMuted ? 0 : volume;
			source.connect(gainNode);
			gainNode.connect(ctx.destination);

			this.remoteScreenAudioNodes.set(userId, { gainNode, audio });
		} catch (err) {
			console.warn('[RTC] Failed to attach remote screen audio:', err);
		}
	}

	private removeRemoteScreenAudio(userId: string): void {
		const node = this.remoteScreenAudioNodes.get(userId);
		if (node) {
			try {
				node.gainNode.disconnect();
				node.audio.srcObject = null;
			} catch {
				/* ignore */
			}
			this.remoteScreenAudioNodes.delete(userId);
		}
	}

	private stopLocalTracks(): void {
		if (this.localAudioSender && this.publishPC) {
			try {
				this.publishPC.removeTrack(this.localAudioSender);
			} catch {
				/* ignore */
			}
			this.localAudioSender = null;
		}
		if (this.localAudioTrack) {
			this.localAudioTrack.stop();
			this.localAudioTrack = null;
		}
		if (this.localVideoTrack) {
			this.localVideoTrack.stop();
			this.localVideoTrack = null;
		}
		if (this.localScreenTrack) {
			this.localScreenTrack.stop();
			this.localScreenTrack = null;
		}
		if (this.localScreenAudioSender && this.publishPC) {
			try {
				this.publishPC.removeTrack(this.localScreenAudioSender);
			} catch {
				/* ignore */
			}
			this.localScreenAudioSender = null;
		}
		if (this.localScreenAudioTrack) {
			this.localScreenAudioTrack.stop();
			this.localScreenAudioTrack = null;
		}
		this.localAudioSender = null;
		this.localVideoSender = null;
		this.localScreenSender = null;
		this.localScreenAudioSender = null;
		this.localAnalyser = null;
	}

	private setupLocalAnalyser(track: MediaStreamTrack): void {
		try {
			const ctx = this.initAudioContext();
			if (!ctx) return;
			const stream = new MediaStream([track]);
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.3;
			source.connect(analyser);
			this.localAnalyser = analyser;
		} catch {
			/* ignore */
		}
	}

	private attachRemoteAudio(userId: string, track: MediaStreamTrack): void {
		const ctx = this.initAudioContext();

		// Cleanup existing node for this user if any
		this.removeRemoteAudio(userId);

		const mediaStream = new MediaStream([track]);
		const audio = new Audio();
		audio.srcObject = mediaStream;
		audio.muted = true; // Muted to avoid duplicate playback alongside Web Audio API
		audio.autoplay = true;

		if (!ctx) {
			return;
		}

		try {
			const source = ctx.createMediaStreamSource(mediaStream);
			const gainNode = ctx.createGain();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.3;

			const store = useVoiceStore.getState();
			const volume = store.userVolumes[userId] ?? 1;
			const isMuted = store.userMutes.has(userId);
			const isDeafened = store.isDeafened;

			gainNode.gain.value = isMuted || isDeafened ? 0 : volume;
			source.connect(gainNode);
			gainNode.connect(analyser);
			analyser.connect(ctx.destination);

			this.remoteAudioNodes.set(userId, { gainNode, audio });
			this.remoteAnalysers.set(userId, analyser);
		} catch {
			try {
				this.remoteAudioNodes.set(userId, { gainNode: ctx.createGain(), audio });
			} catch {
				/* ignore */
			}
		}
	}

	private removeRemoteAudio(userId: string): void {
		const node = this.remoteAudioNodes.get(userId);
		if (node) {
			try {
				node.gainNode.disconnect();
				node.audio.srcObject = null;
			} catch {
				/* ignore */
			}
			this.remoteAudioNodes.delete(userId);
		}
		const analyser = this.remoteAnalysers.get(userId);
		if (analyser) {
			try {
				analyser.disconnect();
			} catch {
				/* ignore */
			}
			this.remoteAnalysers.delete(userId);
		}
		this.speakerLastSpoke.delete(userId);
	}

	private cleanupAudio(): void {
		if (this.vadInterval) {
			clearInterval(this.vadInterval);
			this.vadInterval = null;
		}
		this.stopPingMonitoring();

		this.remoteAudioNodes.forEach((node) => {
			try {
				node.gainNode.disconnect();
				node.audio.srcObject = null;
			} catch {
				/* ignore */
			}
		});
		this.remoteAudioNodes.clear();

		this.remoteAnalysers.forEach((analyser) => {
			try {
				analyser.disconnect();
			} catch {
				/* ignore */
			}
		});
		this.remoteAnalysers.clear();
		this.speakerLastSpoke.clear();
		this.localAnalyser = null;

		if (this.audioContext) {
			try {
				this.audioContext.close();
			} catch {
				/* ignore */
			}
			this.audioContext = null;
		}
	}

	/**
	 * Fast-attack and smooth-decay Voice Activity Detection (VAD) for Discord-style halos.
	 * Checks both local microphone and all active remote subscribers.
	 */
	private startVAD(): void {
		if (this.vadInterval) return;

		const dataArray = new Uint8Array(128);
		const SPEAKING_THRESHOLD = 15;
		const DECAY_HANGTIME_MS = 250;

		this.vadInterval = setInterval(() => {
			const now = Date.now();
			const store = useVoiceStore.getState();
			const currentUserId = useAuthStore.getState().user?.id;
			const isMuted = store.isMuted;

			// Check local microphone
			if (currentUserId && this.localAnalyser && !isMuted) {
				this.localAnalyser.getByteFrequencyData(dataArray);
				let sum = 0;
				for (let i = 0; i < dataArray.length; i++) {
					sum += dataArray[i];
				}
				const avg = sum / dataArray.length;
				if (avg > SPEAKING_THRESHOLD) {
					this.speakerLastSpoke.set(currentUserId, now);
				}
			}

			// Check all remote audio streams
			this.remoteAnalysers.forEach((analyser, userId) => {
				analyser.getByteFrequencyData(dataArray);
				let sum = 0;
				for (let i = 0; i < dataArray.length; i++) {
					sum += dataArray[i];
				}
				const avg = sum / dataArray.length;
				if (avg > SPEAKING_THRESHOLD) {
					this.speakerLastSpoke.set(userId, now);
				}
			});

			// Calculate currently speaking users based on fast-attack & 250ms hangtime decay
			const newSpeaking = new Set<string>();
			this.speakerLastSpoke.forEach((lastTime, userId) => {
				if (now - lastTime <= DECAY_HANGTIME_MS) {
					newSpeaking.add(userId);
				}
			});

			// Only trigger React state update if the speaking set actually changed
			const currentSpeaking = store.speakingUsers;
			let changed = newSpeaking.size !== currentSpeaking.size;
			if (!changed) {
				for (const u of newSpeaking) {
					if (!currentSpeaking.has(u)) {
						changed = true;
						break;
					}
				}
			}

			if (changed) {
				store._setInternalState({ speakingUsers: newSpeaking });
			}
		}, 40); // 25fps update rate for ultra-responsive indicators
	}

	/**
	 * Monitors RTC round-trip time (ping) via RTCPeerConnection stats.
	 */
	private startPingMonitoring(): void {
		if (this.pingInterval) return;

		const queryStats = async () => {
			const pc = this.publishPC || this.subscribePC;
			if (!pc) return;

			try {
				const stats = await pc.getStats();
				let rttMs: number | null = null;
				stats.forEach((report) => {
					if (
						report.type === 'candidate-pair' &&
						(report.state === 'succeeded' || report.nominated)
					) {
						if (typeof report.currentRoundTripTime === 'number') {
							rttMs = Math.round(report.currentRoundTripTime * 1000);
						} else if (typeof (report as any).roundTripTime === 'number') {
							rttMs = Math.round((report as any).roundTripTime * 1000);
						}
					}
				});

				if (rttMs !== null) {
					useVoiceStore.getState().setPing(rttMs);
				}
			} catch {
				/* ignore */
			}
		};

		queryStats();
		this.pingInterval = setInterval(queryStats, 2000);
	}

	private stopPingMonitoring(): void {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
		useVoiceStore.getState().setPing(null);
	}
}

/**
 * Singleton instance of the WebRTC manager for client-web.
 */
export const webRTCManager = new WebRTCManager();
