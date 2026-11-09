/**
 * Call manager for air-gapped servers (voice.mode = "raw_udp"), used by the desktop app only.
 *
 * It exposes the same surface as WebRTCManager. Signalling (call_*) runs over the authenticated WebSocket exactly as
 * in WebRTC mode; media is captured and encoded here with WebCodecs (Opus, H.264 Annex-B), handed to the Go UDP
 * session through {@link MediaBridge}, and decoded frames are rendered into MediaStreams the call UI already shows.
 */

import {
	onWS,
	wsSendCallJoin,
	wsSendCallLeave,
	wsSendCallTrackState,
	type CallJoinedPayload,
	type CallTrackStatePayload,
	type CallParticipantEventPayload,
	type CallErrorPayload,
	type ParticipantInfo,
} from '@/ws';
import { useVoiceStore, type ScreenShareSettings } from '@/store/voiceStore';
import { useAppStore } from '@/store/app.slice';
import { useAuthStore } from '@/store/store';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { apiClient } from '@/api/client';
import { KIND_AUDIO, KIND_SCREEN, KIND_VIDEO, CODEC_H264, CODEC_OPUS, FLAG_KEYFRAME, type PackedFrame } from './media-batch';
import {
	AUDIO_SAMPLE_RATE,
	CAMERA_BITRATE,
	H264_DECODER_CONFIG,
	MAX_FRAME_BYTES,
	OPUS_ENCODER_CONFIG,
	SCREEN_BITRATE,
	allowKeyframe,
	detectCodecSupport,
	fitEven,
	h264EncoderConfig,
	schedulePlayout,
	screenLimit,
	type PlayoutState,
} from './udp-policy';
import { createWailsMediaBridge, type MediaBridge } from './udp-bridge';
import type { WebRTCOptions } from './WebRTCManager';

const CONNECT_TIMEOUT_MS = 12_000;

/** MediaStreamTrackProcessor is not in lib.dom yet. */
interface TrackProcessor<T> {
	readable: ReadableStream<T>;
}
type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessor<AudioData & VideoFrame>;

interface RemoteAudio {
	decoder: AudioDecoder;
	gain: GainNode;
	analyser: AnalyserNode;
	playout: PlayoutState | null;
}
interface RemoteVideo {
	decoder: VideoDecoder;
	stream: MediaStream;
	ready: boolean;
}
interface Capture {
	track: MediaStreamTrack;
	stop: () => void;
}

let udpPort: number | undefined;
/** Records the UDP port advertised by /api/version so the manager can dial it. */
export function setUdpPort(p: number | undefined): void {
	udpPort = p;
}

/** "host:udp_port" of the server the app is signed in to. */
function serverAddress(): string {
	const base = apiClient.defaults.baseURL || window.location.origin;
	const host = new URL(base, window.location.origin).hostname;
	return `${host.includes(':') ? `[${host}]` : host}:${udpPort ?? 9090}`;
}

export class UdpMediaManager {
	private channelId: string | null = null;
	private bridge: MediaBridge | null = null;
	private readonly bridgeFactory: () => MediaBridge;
	private unsubs: Array<() => void> = [];
	private connectTimer: ReturnType<typeof setTimeout> | null = null;
	private isConnecting = false;
	private deviceBusy = false;

	private mediaIds = new Map<number, string>(); // media_id -> user id
	private userMediaIds = new Map<string, number>();

	private audioContext: AudioContext | null = null;
	private localAnalyser: AnalyserNode | null = null;
	private remoteAudio = new Map<string, RemoteAudio>();
	private remoteVideo = new Map<string, RemoteVideo>(); // key `${user}:${kind}`
	private speakerLastSpoke = new Map<string, number>();
	private vadInterval: ReturnType<typeof setInterval> | null = null;

	private micCapture: Capture | null = null;
	private micTrack: MediaStreamTrack | null = null;
	private camCapture: Capture | null = null;
	private screenCapture: Capture | null = null;
	private forceKey = new Set<number>();
	private lastKey = new Map<number, number>();

	private outbox: PackedFrame[] = [];
	private flushTimer: ReturnType<typeof setInterval> | null = null;

	/** @param bridgeFactory - creates the Go bridge; replaced by a fake in tests. */
	constructor(bridgeFactory: () => MediaBridge = createWailsMediaBridge) {
		this.bridgeFactory = bridgeFactory;
	}

	private initAudioContext(): AudioContext | null {
		if (this.audioContext) return this.audioContext;
		try {
			this.audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
			void this.audioContext.resume().catch(() => {});
		} catch {
			/* AudioContext may be restricted */
		}
		return this.audioContext;
	}

	/** Joins (or starts) the call in a channel. */
	public async join(channelId: string, options?: WebRTCOptions): Promise<void> {
		if (this.channelId === channelId && this.isConnecting) return;
		if (this.channelId) await this.leave();

		const support = await detectCodecSupport();
		if (!support.audio) {
			toast.error(i18n.t('calls.codecsMissing'));
			return;
		}
		this.initAudioContext();
		this.channelId = channelId;
		this.isConnecting = true;
		const store = useVoiceStore.getState();
		store._setInternalState({ activeChannelId: channelId, isActive: true, callStatus: 'connecting' });
		store.addLog(`[UDP] Joining call in channel ${channelId}...`);

		try {
			this.bridge = this.bridgeFactory();
			const req = await this.bridge.begin();
			this.setupSignalingListeners(options, support.video);
			wsSendCallJoin(channelId, req);
		} catch (err) {
			store.addLog(`[UDP] Could not start media session: ${err}`);
			toast.error(i18n.t('call.connectFailed'));
			await this.leave();
			return;
		}
		this.clearConnectTimer();
		this.connectTimer = setTimeout(() => {
			if (this.channelId === channelId && this.isConnecting) {
				toast.error(i18n.t('call.connectFailed'));
				void this.leave();
			}
		}, CONNECT_TIMEOUT_MS);
	}

	/** Leaves the call and releases devices, decoders and the UDP session. */
	public async leave(): Promise<void> {
		if (!this.channelId) return;
		const prev = this.channelId;
		this.clearConnectTimer();
		this.channelId = null;
		this.isConnecting = false;
		this.deviceBusy = false;
		wsSendCallLeave(prev);
		this.unsubs.forEach((u) => u());
		this.unsubs = [];
		this.micCapture?.stop();
		this.camCapture?.stop();
		this.screenCapture?.stop();
		this.micCapture = this.camCapture = this.screenCapture = null;
		this.micTrack = null;
		if (this.flushTimer) clearInterval(this.flushTimer);
		this.flushTimer = null;
		this.outbox = [];
		[...this.remoteAudio.keys(), ...[...this.remoteVideo.keys()].map((k) => k.split(':')[0])].forEach((u) => this.removeRemote(u));
		if (this.vadInterval) clearInterval(this.vadInterval);
		this.vadInterval = null;
		this.speakerLastSpoke.clear();
		this.localAnalyser = null;
		this.mediaIds.clear();
		this.userMediaIds.clear();
		void this.bridge?.close().catch(() => {});
		this.bridge = null;
		if (this.audioContext) {
			void this.audioContext.close().catch(() => {});
			this.audioContext = null;
		}
		const store = useVoiceStore.getState();
		store.leaveVoice();
		store.addLog(`[UDP] Left call in channel ${prev}`);
	}

	/** Mutes or unmutes the microphone; retries the capture if it could not be opened earlier. */
	public async toggleMute(): Promise<void> {
		if (!this.channelId || !this.bridge) return;
		const store = useVoiceStore.getState();
		const nextMuted = !store.isMuted;
		if (!this.micTrack) {
			if (nextMuted) {
				store._setInternalState({ isMuted: true });
				return;
			}
			if (this.deviceBusy) return;
			this.deviceBusy = true;
			try {
				if (!(await this.startMic())) return;
			} finally {
				this.deviceBusy = false;
			}
		}
		if (this.micTrack) this.micTrack.enabled = !nextMuted;
		store._setInternalState({ isMuted: nextMuted });
		wsSendCallTrackState(this.channelId, 'audio', !nextMuted);
	}

	/** Mutes all incoming call audio. */
	public toggleDeafen(): void {
		const next = !useVoiceStore.getState().isDeafened;
		useVoiceStore.getState()._setInternalState({ isDeafened: next });
		const s = useVoiceStore.getState();
		this.remoteAudio.forEach((r, u) => {
			r.gain.gain.value = next || s.userMutes.has(u) ? 0 : (s.userVolumes[u] ?? 1);
		});
	}

	/** Starts or stops the camera. */
	public async toggleVideo(): Promise<void> {
		if (!this.channelId || !this.bridge || this.deviceBusy) return;
		this.deviceBusy = true;
		try {
			if (useVoiceStore.getState().isVideoEnabled) this.stopCamera();
			else await this.startCamera();
		} finally {
			this.deviceBusy = false;
		}
	}

	/** Starts or stops screen sharing. */
	public async toggleScreenShare(customSettings?: Partial<ScreenShareSettings>): Promise<void> {
		if (!this.channelId || !this.bridge) return;
		const store = useVoiceStore.getState();
		if (store.isScreenSharing) {
			this.stopScreen();
			return;
		}
		if (customSettings) store.setScreenShareSettings(customSettings);
		const settings = useVoiceStore.getState().screenShareSettings;
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: { frameRate: { max: settings.frameRate, ideal: settings.frameRate } },
				audio: false, // the protocol carries one audio stream per participant; screen audio is not sent
			});
			const track = stream.getVideoTracks()[0];
			if (!track) return;
			try {
				track.contentHint = settings.contentHint || 'detail';
			} catch {
				/* ignore */
			}
			track.onended = () => {
				if (this.screenCapture?.track === track) this.stopScreen();
			};
			this.screenCapture = this.startVideoEncoder(track, KIND_SCREEN, SCREEN_BITRATE, settings.frameRate, screenLimit(settings.resolution));
			useVoiceStore.getState()._setInternalState({ isScreenSharing: true, localScreenStream: stream, spotlightStreamId: 'local' });
			wsSendCallTrackState(this.channelId, 'screen', true, track.id, stream.id);
		} catch (err) {
			useVoiceStore.getState().addLog(`[UDP] Screen sharing cancelled or failed: ${err}`);
			if (!(err instanceof DOMException && err.name === 'NotAllowedError')) toast.error(i18n.t('call.screenError'));
		}
	}

	/** Applies new screen-share settings to the running capture (size changes apply on the next share). */
	public async applyScreenShareConstraints(newSettings: Partial<ScreenShareSettings>): Promise<void> {
		useVoiceStore.getState().setScreenShareSettings(newSettings);
		const track = this.screenCapture?.track;
		if (!track) return;
		const s = useVoiceStore.getState().screenShareSettings;
		try {
			await track.applyConstraints({ frameRate: { max: s.frameRate, ideal: s.frameRate } });
			track.contentHint = s.contentHint || 'detail';
		} catch (err) {
			useVoiceStore.getState().addLog(`[UDP] Failed to apply screen constraints: ${err}`);
		}
	}

	/** Asks the publisher of a camera/screen stream for a keyframe (everyone with video when unspecified). */
	public requestKeyframe(targetUserId?: string): void {
		if (!this.bridge) return;
		const ids = targetUserId ? [this.userMediaIds.get(targetUserId)] : [...this.userMediaIds.values()];
		for (const id of ids) {
			if (id === undefined) continue;
			void this.bridge.requestKeyframe(id, KIND_VIDEO).catch(() => {});
			void this.bridge.requestKeyframe(id, KIND_SCREEN).catch(() => {});
		}
	}

	/** Stores the volume of a remote screen share (UDP mode carries no screen audio). */
	public setScreenShareVolume(userId: string, volume: number): void {
		useVoiceStore.getState().setScreenShareVolume(userId, volume);
	}

	/** Toggles the stored mute of a remote screen share. */
	public toggleScreenShareMute(userId: string): void {
		useVoiceStore.getState().toggleScreenShareMute(userId);
	}

	/** Sets the playback volume of one participant (0..2). */
	public setParticipantVolume(userId: string, volume: number): void {
		useVoiceStore.getState().setUserVolume(userId, volume);
		const r = this.remoteAudio.get(userId);
		const s = useVoiceStore.getState();
		if (r) r.gain.gain.value = s.userMutes.has(userId) || s.isDeafened ? 0 : volume;
	}

	/** Mutes or unmutes one participant locally. */
	public toggleParticipantMute(userId: string): void {
		useVoiceStore.getState().toggleUserMute(userId);
		const s = useVoiceStore.getState();
		const r = this.remoteAudio.get(userId);
		if (r) r.gain.gain.value = s.userMutes.has(userId) || s.isDeafened ? 0 : (s.userVolumes[userId] ?? 1);
	}

	// ── signalling ─────────────────────────────────────────────────────────

	private setupSignalingListeners(options: WebRTCOptions | undefined, videoOk: boolean): void {
		this.unsubs.push(
			onWS('call_joined', async (raw) => {
				const p = raw as CallJoinedPayload;
				if (p.channel_id !== this.channelId) return;
				try {
					await this.handleCallJoined(p, options, videoOk);
				} catch (err) {
					useVoiceStore.getState().addLog(`[UDP] Failed to set up call: ${err}`);
					toast.error(i18n.t('call.connectFailed'));
					void this.leave();
				}
			}),
			onWS('call_track_state', (raw) => {
				const p = raw as CallTrackStatePayload;
				if (p.channel_id !== this.channelId || !p.user_id) return;
				useVoiceStore.getState().setTrackState(p.user_id, p.kind, p.enabled);
				if (!p.enabled && p.kind !== 'audio') this.dropRemoteVideo(p.user_id, p.kind === 'screen' ? KIND_SCREEN : KIND_VIDEO);
				if (p.kind !== 'audio' && p.enabled) {
					this.requestKeyframe(p.user_id);
					setTimeout(() => this.requestKeyframe(p.user_id), 300);
				}
			}),
			onWS('call_participant_joined', (raw) => {
				const p = raw as CallParticipantEventPayload;
				if (p.channel_id !== this.channelId) return;
				this.registerParticipant(p.user);
				const store = useVoiceStore.getState();
				const cur = store.participants[this.channelId] || [];
				if (!cur.includes(p.user.user_id)) store.updateParticipants(this.channelId, [...cur, p.user.user_id]);
				for (const [k, v] of Object.entries(p.user.track_states ?? {})) {
					store.setTrackState(p.user.user_id, k as 'audio' | 'video' | 'screen', v);
				}
			}),
			onWS('call_participant_left', (raw) => {
				const p = raw as CallParticipantEventPayload;
				if (p.channel_id !== this.channelId) return;
				const store = useVoiceStore.getState();
				store.updateParticipants(this.channelId, (store.participants[this.channelId] || []).filter((id) => id !== p.user.user_id));
				store.removeRemoteStream(p.user.user_id);
				this.removeRemote(p.user.user_id);
			}),
			// A UDP session error or a server-side close (kick, removal, timeout) ends the call for this client.
			onWS('call_error', (raw) => {
				const p = raw as CallErrorPayload;
				if (p.channel_id && p.channel_id !== this.channelId) return;
				useVoiceStore.getState().addLog(`[UDP] Server error: ${p.error}`);
				void this.leave();
			}),
			onWS('call_ended', (raw) => {
				const p = raw as CallErrorPayload;
				if (p.channel_id && p.channel_id !== this.channelId) return;
				useVoiceStore.getState().addLog(`[UDP] Call ended by server: ${p.reason ?? ''}`);
				void this.leave();
			}),
		);
	}

	private registerParticipant(p: ParticipantInfo): void {
		if (p.media_id === undefined) return;
		this.mediaIds.set(p.media_id, p.user_id);
		this.userMediaIds.set(p.user_id, p.media_id);
	}

	private async handleCallJoined(p: CallJoinedPayload, options: WebRTCOptions | undefined, videoOk: boolean): Promise<void> {
		this.clearConnectTimer();
		if (!p.media || !this.bridge) throw new Error('server did not return media parameters');
		const store = useVoiceStore.getState();
		const participants = p.participants ?? [];
		participants.forEach((x) => this.registerParticipant(x));
		const selfId = useAuthStore.getState().user?.id ?? p.self_id;
		const ids = participants.map((x) => x.user_id);
		if (!ids.includes(selfId)) ids.push(selfId);
		store.updateParticipants(p.channel_id, ids);
		for (const x of participants) {
			const ts = x.track_states;
			store.setTrackState(x.user_id, 'audio', ts ? ts.audio !== false : true);
			store.setTrackState(x.user_id, 'video', !!ts?.video);
			store.setTrackState(x.user_id, 'screen', !!ts?.screen);
		}

		this.unsubs.push(
			this.bridge.onFrames((frames) => frames.forEach((f) => this.handleRemoteFrame(f))),
			this.bridge.onKeyframeRequest((kind) => this.forceKey.add(kind)),
		);
		await this.bridge.complete(serverAddress(), p.media, p.channel_id, selfId);
		this.flushTimer = setInterval(() => this.flush(), 10);

		const micOk = await this.startMic();
		if (!micOk) store._setInternalState({ isMuted: true });
		else if (this.micTrack) this.micTrack.enabled = !useVoiceStore.getState().isMuted;
		store._setInternalState({ callStatus: 'connected' });
		this.isConnecting = false;
		this.startVAD();
		wsSendCallTrackState(p.channel_id, 'audio', !useVoiceStore.getState().isMuted);
		if (options?.video && videoOk) await this.startCamera();
	}

	private clearConnectTimer(): void {
		if (this.connectTimer) clearTimeout(this.connectTimer);
		this.connectTimer = null;
	}

	// ── sending ────────────────────────────────────────────────────────────

	private send(f: Omit<PackedFrame, 'src'>): void {
		if (f.data.length > MAX_FRAME_BYTES) return; // does not fit 64 fragments; receivers recover with a keyframe request
		this.outbox.push({ ...f, src: 0 });
	}

	private flush(): void {
		if (!this.bridge || this.outbox.length === 0) return;
		const batch = this.outbox;
		this.outbox = [];
		void this.bridge.sendFrames(batch).catch((err) => useVoiceStore.getState().addLog(`[UDP] send failed: ${err}`));
	}

	private async startMic(): Promise<boolean> {
		if (this.micCapture) return true;
		const preferred = useAppStore.getState().preferredMicId;
		const base: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
		try {
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: preferred && preferred !== 'default' ? { ...base, deviceId: { exact: preferred } } : base,
				});
			} catch (err) {
				if (err instanceof DOMException && err.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: base });
				else throw err;
			}
			const track = stream.getAudioTracks()[0];
			if (!track) return false;
			this.micTrack = track;
			this.setupLocalAnalyser(track);
			this.micCapture = this.startAudioEncoder(track);
			useVoiceStore.getState()._setInternalState({ localStream: this.localStream() });
			return true;
		} catch (err) {
			useVoiceStore.getState().addLog(`[UDP] Failed to acquire microphone: ${err}`);
			toast.error(i18n.t('call.micError'));
			return false;
		}
	}

	private startAudioEncoder(track: MediaStreamTrack): Capture {
		const Proc = (globalThis as unknown as { MediaStreamTrackProcessor: TrackProcessorCtor }).MediaStreamTrackProcessor;
		const encoder = new AudioEncoder({
			output: (chunk) => {
				const data = new Uint8Array(chunk.byteLength);
				chunk.copyTo(data);
				this.send({ kind: KIND_AUDIO, codec: CODEC_OPUS, flags: 0, ts: Math.round(chunk.timestamp / 1000) >>> 0, data });
			},
			error: (e) => useVoiceStore.getState().addLog(`[UDP] audio encoder: ${e}`),
		});
		encoder.configure(OPUS_ENCODER_CONFIG);
		const reader = new Proc({ track }).readable.getReader();
		let stopped = false;
		void (async () => {
			for (;;) {
				const { value, done } = await reader.read();
				if (done || stopped) break;
				// A muted track yields silence; skipping it saves bandwidth.
				if (track.enabled && encoder.state === 'configured') encoder.encode(value);
				value.close();
			}
		})().catch(() => {});
		return {
			track,
			stop: () => {
				stopped = true;
				track.stop();
				void reader.cancel().catch(() => {});
				if (encoder.state !== 'closed') encoder.close();
			},
		};
	}

	private startVideoEncoder(track: MediaStreamTrack, kind: number, bitrate: number, fps: number, limit: { w: number; h: number } | null): Capture {
		const Proc = (globalThis as unknown as { MediaStreamTrackProcessor: TrackProcessorCtor }).MediaStreamTrackProcessor;
		const encoder = new VideoEncoder({
			output: (chunk) => {
				const data = new Uint8Array(chunk.byteLength);
				chunk.copyTo(data);
				this.send({ kind, codec: CODEC_H264, flags: chunk.type === 'key' ? FLAG_KEYFRAME : 0, ts: Math.round(chunk.timestamp / 1000) >>> 0, data });
			},
			error: (e) => useVoiceStore.getState().addLog(`[UDP] video encoder: ${e}`),
		});
		const reader = new Proc({ track }).readable.getReader();
		let stopped = false;
		let configured = false;
		let sinceKey = 0;
		void (async () => {
			for (;;) {
				const { value, done } = await reader.read();
				if (done || stopped) break;
				const frame = value as unknown as VideoFrame;
				if (!configured) {
					const { w, h } = fitEven(frame.displayWidth, frame.displayHeight, limit);
					encoder.configure(h264EncoderConfig(w, h, fps, bitrate));
					configured = true;
				}
				const now = performance.now();
				const wanted = this.forceKey.delete(kind) || sinceKey++ >= fps * 5;
				const key = wanted && allowKeyframe(this.lastKey.get(kind) ?? null, now);
				if (key) {
					this.lastKey.set(kind, now);
					sinceKey = 0;
				}
				// Back-pressure: dropping a frame beats growing latency when the encoder falls behind.
				if (encoder.encodeQueueSize < 4) encoder.encode(frame, { keyFrame: key });
				frame.close();
			}
		})().catch(() => {});
		this.forceKey.add(kind);
		return {
			track,
			stop: () => {
				stopped = true;
				track.stop();
				void reader.cancel().catch(() => {});
				if (encoder.state !== 'closed') encoder.close();
			},
		};
	}

	private async startCamera(): Promise<void> {
		if (!this.channelId) return;
		const size = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
		const preferred = useVoiceStore.getState().preferredCameraId;
		try {
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: preferred ? { ...size, deviceId: { exact: preferred } } : size });
			} catch (err) {
				if (preferred && err instanceof DOMException && err.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ video: size });
				else throw err;
			}
			const track = stream.getVideoTracks()[0];
			if (!track) return;
			track.onended = () => {
				if (this.camCapture?.track === track) this.stopCamera();
			};
			this.camCapture = this.startVideoEncoder(track, KIND_VIDEO, CAMERA_BITRATE, 30, null);
			useVoiceStore.getState()._setInternalState({ isVideoEnabled: true, localStream: this.localStream() });
			wsSendCallTrackState(this.channelId, 'video', true);
		} catch (err) {
			useVoiceStore.getState().addLog(`[UDP] Failed to access camera: ${err}`);
			toast.error(i18n.t('call.cameraError'));
		}
	}

	private stopCamera(): void {
		this.camCapture?.stop();
		this.camCapture = null;
		useVoiceStore.getState()._setInternalState({ isVideoEnabled: false, localStream: this.localStream() });
		if (this.channelId) wsSendCallTrackState(this.channelId, 'video', false);
	}

	private stopScreen(): void {
		this.screenCapture?.stop();
		this.screenCapture = null;
		const s = useVoiceStore.getState();
		s._setInternalState({
			isScreenSharing: false,
			localScreenStream: null,
			spotlightStreamId: s.spotlightStreamId === 'local' ? null : s.spotlightStreamId,
		});
		if (this.channelId) wsSendCallTrackState(this.channelId, 'screen', false);
	}

	private localStream(): MediaStream {
		const tracks: MediaStreamTrack[] = [];
		if (this.micTrack) tracks.push(this.micTrack);
		if (this.camCapture) tracks.push(this.camCapture.track);
		return new MediaStream(tracks);
	}

	// ── receiving ──────────────────────────────────────────────────────────

	private handleRemoteFrame(f: PackedFrame): void {
		const userId = this.mediaIds.get(f.src);
		if (!userId) return;
		if (f.kind === KIND_AUDIO && f.codec === CODEC_OPUS) this.playAudio(userId, f);
		else if ((f.kind === KIND_VIDEO || f.kind === KIND_SCREEN) && f.codec === CODEC_H264) {
			// A stream the sender announced as stopped must not be revived by frames still in flight: that would create a
			// tile (and decoder) that nothing ever removes again. The track-state event enabling it requests a keyframe,
			// so dropping early frames costs at most one round trip.
			const on = useVoiceStore.getState().participantTrackStates[userId]?.[f.kind === KIND_SCREEN ? 'screen' : 'video'];
			if (on === true) this.playVideo(userId, f);
		}
	}

	private playAudio(userId: string, f: PackedFrame): void {
		const ctx = this.audioContext;
		if (!ctx) return;
		let r = this.remoteAudio.get(userId);
		if (!r) {
			const gain = ctx.createGain();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.3;
			const s = useVoiceStore.getState();
			gain.gain.value = s.userMutes.has(userId) || s.isDeafened ? 0 : (s.userVolumes[userId] ?? 1);
			gain.connect(analyser);
			analyser.connect(ctx.destination);
			const entry: RemoteAudio = {
				gain,
				analyser,
				playout: null,
				decoder: new AudioDecoder({
					output: (data) => this.enqueueAudio(entry, data),
					error: (e) => useVoiceStore.getState().addLog(`[UDP] audio decoder: ${e}`),
				}),
			};
			entry.decoder.configure({ codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 1 });
			this.remoteAudio.set(userId, entry);
			r = entry;
		}
		if (r.decoder.state === 'configured') {
			r.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: f.ts * 1000, data: f.data }));
		}
	}

	private enqueueAudio(r: RemoteAudio, data: AudioData): void {
		const ctx = this.audioContext;
		if (!ctx) return data.close();
		const buf = ctx.createBuffer(1, data.numberOfFrames, data.sampleRate);
		const tmp = new Float32Array(data.numberOfFrames);
		data.copyTo(tmp, { planeIndex: 0, format: 'f32-planar' });
		buf.copyToChannel(tmp, 0);
		const { start, state } = schedulePlayout(r.playout, ctx.currentTime, buf.duration);
		r.playout = state;
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect(r.gain);
		src.start(start);
		data.close();
	}

	private playVideo(userId: string, f: PackedFrame): void {
		const key = `${userId}:${f.kind}`;
		let v = this.remoteVideo.get(key);
		if (!v) {
			// Decoded frames are drawn to a canvas whose capture stream feeds the existing tile components.
			const canvas = document.createElement('canvas');
			const ctx2d = canvas.getContext('2d');
			const entry: RemoteVideo = {
				stream: canvas.captureStream(30),
				ready: false,
				decoder: new VideoDecoder({
					output: (frame) => {
						if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
							canvas.width = frame.displayWidth;
							canvas.height = frame.displayHeight;
						}
						ctx2d?.drawImage(frame, 0, 0);
						frame.close();
					},
					error: (e) => {
						useVoiceStore.getState().addLog(`[UDP] video decoder: ${e}`);
						this.remoteVideo.delete(key);
					},
				}),
			};
			entry.decoder.configure(H264_DECODER_CONFIG);
			this.remoteVideo.set(key, entry);
			const store = useVoiceStore.getState();
			if (f.kind === KIND_SCREEN) {
				store.setRemoteScreenStream(userId, entry.stream);
				store.setTrackState(userId, 'screen', true);
			} else {
				store.setRemoteStream(userId, entry.stream);
			}
			v = entry;
		}
		const keyframe = (f.flags & FLAG_KEYFRAME) !== 0;
		if (!v.ready && !keyframe) {
			this.requestKeyframe(userId); // joined mid-stream: nothing decodes before the first keyframe
			return;
		}
		v.ready = true;
		if (v.decoder.state === 'configured') {
			v.decoder.decode(new EncodedVideoChunk({ type: keyframe ? 'key' : 'delta', timestamp: f.ts * 1000, data: f.data }));
		}
	}

	private dropRemoteVideo(userId: string, kind: number): void {
		const key = `${userId}:${kind}`;
		const v = this.remoteVideo.get(key);
		if (v) {
			if (v.decoder.state !== 'closed') v.decoder.close();
			this.remoteVideo.delete(key);
		}
		// Clear the tile even when no decoder exists (the stream may only have been announced), so it can never linger.
		if (kind === KIND_SCREEN) useVoiceStore.getState().setRemoteScreenStream(userId, null);
	}

	private removeRemote(userId: string): void {
		const r = this.remoteAudio.get(userId);
		if (r) {
			if (r.decoder.state !== 'closed') r.decoder.close();
			try {
				r.gain.disconnect();
				r.analyser.disconnect();
			} catch {
				/* ignore */
			}
			this.remoteAudio.delete(userId);
		}
		this.dropRemoteVideo(userId, KIND_VIDEO);
		this.dropRemoteVideo(userId, KIND_SCREEN);
		this.speakerLastSpoke.delete(userId);
		const id = this.userMediaIds.get(userId);
		if (id !== undefined) this.mediaIds.delete(id);
		this.userMediaIds.delete(userId);
	}

	private setupLocalAnalyser(track: MediaStreamTrack): void {
		try {
			const ctx = this.initAudioContext();
			if (!ctx) return;
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.3;
			ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
			this.localAnalyser = analyser;
		} catch {
			/* ignore */
		}
	}

	/** Same fast-attack, 250 ms hang-time speaking detector as the WebRTC manager. */
	private startVAD(): void {
		if (this.vadInterval) return;
		const arr = new Uint8Array(128);
		const avg = (a: AnalyserNode) => {
			a.getByteFrequencyData(arr);
			return arr.reduce((x, y) => x + y, 0) / arr.length;
		};
		this.vadInterval = setInterval(() => {
			const now = Date.now();
			const store = useVoiceStore.getState();
			const me = useAuthStore.getState().user?.id;
			if (me && this.localAnalyser && !store.isMuted && avg(this.localAnalyser) > 15) this.speakerLastSpoke.set(me, now);
			this.remoteAudio.forEach((r, u) => {
				if (avg(r.analyser) > 15) this.speakerLastSpoke.set(u, now);
			});
			const next = new Set<string>();
			this.speakerLastSpoke.forEach((t, u) => now - t <= 250 && next.add(u));
			const cur = store.speakingUsers;
			if (next.size !== cur.size || [...next].some((u) => !cur.has(u))) store._setInternalState({ speakingUsers: next });
		}, 40);
	}
}

/** Singleton used by the desktop app in raw_udp mode. */
export const udpMediaManager = new UdpMediaManager();
