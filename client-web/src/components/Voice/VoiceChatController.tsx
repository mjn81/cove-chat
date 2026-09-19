import React, { useEffect, useRef } from 'react';
import { useVoiceStore } from '@/store/voiceStore';
import { useAuthStore, useChannelStore, useAppStore } from '@/store/store';
import { VoiceChatPanel } from './VoiceChatPanel';
import { isWails } from '@/utils/wails';
import { onWS } from '@/ws';

export const VoiceChatController: React.FC = () => {
	// Individual field selectors instead of a blanket `useVoiceStore()`
	// destructure: the latter subscribes to the ENTIRE store, so this
	// component re-rendered on every store mutation — including `logs`
	// (written on every boot step and error) and `userVolumes`/`userMutes`
	// (already selected separately below) — not just the fields it actually
	// renders with. That mattered most during an active call, where the
	// component also holds the MediaStream/AudioContext refs driving
	// real-time audio.
	const activeChannelId = useVoiceStore(state => state.activeChannelId);
	const isActive = useVoiceStore(state => state.isActive);
	const isMuted = useVoiceStore(state => state.isMuted);
	const isDeafened = useVoiceStore(state => state.isDeafened);
	const speakingUsers = useVoiceStore(state => state.speakingUsers);
	const leaveVoice = useVoiceStore(state => state.leaveVoice);
	const _setInternalState = useVoiceStore(state => state._setInternalState);
	const addLog = useVoiceStore(state => state.addLog);
	const { user } = useAuthStore();
	const token = user?.token || localStorage.getItem('nodetalk_token') || '';
	const channels = useChannelStore(state => state.channels);

	const { preferredMicId } = useAppStore();

	const streamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const remotePlayersRef = useRef<Map<string, { node: ScriptProcessorNode, gainNode: GainNode, queue: Float32Array[] }>>(new Map());
	const remoteGainRef = useRef<GainNode | null>(null);
	// Per-user "stop showing speaking indicator" fade-out timers. Previously
	// stored as ad-hoc `window` globals keyed by user id — never cleared on
	// unmount/stop, so rapid join/leave cycles leaked timers indefinitely and
	// bypassed React's lifecycle guarantees entirely.
	const speakingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	const markSpeaking = (userId: string) => {
		const currentSpeakers = new Set(useVoiceStore.getState().speakingUsers);
		if (!currentSpeakers.has(userId)) {
			currentSpeakers.add(userId);
			_setInternalState({ speakingUsers: currentSpeakers });
		}
	};

	const clearSpeakingTimeout = (userId: string) => {
		const existing = speakingTimeoutsRef.current.get(userId);
		if (existing) {
			clearTimeout(existing);
			speakingTimeoutsRef.current.delete(userId);
		}
	};

	const scheduleSpeakingClear = (userId: string, delayMs: number) => {
		clearSpeakingTimeout(userId);
		const id = setTimeout(() => {
			const next = new Set(useVoiceStore.getState().speakingUsers);
			next.delete(userId);
			_setInternalState({ speakingUsers: next });
			speakingTimeoutsRef.current.delete(userId);
		}, delayMs);
		speakingTimeoutsRef.current.set(userId, id);
	};

	const activeChannel = channels.find(c => c.id === activeChannelId);

	// Core Logic: Start/Stop Voice based on isActive and activeChannelId
	useEffect(() => {
		let isMounted = true;

		const start = async () => {
			const hasUser = !!user;
			const hasToken = !!token;
			addLog(`BOOT: isActive=${isActive}, channel=${activeChannelId}, wails=${isWails()}, user=${hasUser}, token=${hasToken}`);
			if (!isActive || !activeChannelId || !user || !hasToken) {
				addLog(`BOOT ABORTED: requirements check failed (isActive: ${isActive}, channel: ${!!activeChannelId}, user: ${hasUser}, token: ${hasToken})`);
				return;
			}

			try {
				const wails = (window as any).go?.main?.App;
				addLog(`WAILS OBJECT: ${wails ? 'Found' : 'MISSING'}`);
				if (wails) {
					addLog(`WAILS METHODS: ${Object.keys(wails).join(', ')}`);
				}

				if (isWails() && wails) {
					if (wails.RequestMicrophonePermission) {
						addLog('STEP 1: Requesting Mic Permission...');
						await wails.RequestMicrophonePermission();
						addLog('STEP 1: Request completed.');
					} else {
						addLog('STEP 1: SKIP (Method RequestMicrophonePermission missing)');
					}
					
					if (wails.GetMicrophonePermissionStatus) {
						addLog('STEP 2: Checking Mic Status...');
						let status = await wails.GetMicrophonePermissionStatus();
						addLog(`STEP 2: Initial status = ${status}`);
						
						let attempts = 0;
						while (status === 0 && attempts < 60) {
							await new Promise(resolve => setTimeout(resolve, 500));
							status = await wails.GetMicrophonePermissionStatus();
							attempts++;
							if (attempts % 10 === 0) addLog(`STEP 2: Polling... (status: ${status}, attempt: ${attempts})`);
						}
						
						addLog(`STEP 2: Final status = ${status}`);
						if (status !== 3) {
							addLog(`STEP 2: FAILED (Permission denied: ${status})`);
							leaveVoice();
							return;
						}
					} else {
						addLog('STEP 2: SKIP (Method GetMicrophonePermissionStatus missing)');
					}
				}

				addLog('STEP 3: Fetching Server Config...');
				let serverUrl = '';
				if (wails?.GetServerURL) {
					serverUrl = await wails.GetServerURL();
				} else {
					addLog('WARNING: GetServerURL missing, using fallback localhost:4000');
					serverUrl = 'http://localhost:4000';
				}
				addLog(`STEP 3: URL = ${serverUrl}`);
				
				const host = new URL(serverUrl).hostname;
				const resp = await fetch(`${serverUrl}/api/version`);
				const serverInfo = await resp.json();
				const udpPort = serverInfo.udp_port || 9090;
				addLog(`STEP 4: Server Version OK. UDP Port = ${udpPort}`);

				if (wails?.StartVoiceChat) {
					addLog(`STEP 5: Starting Voice UDP (host=${host}, port=${udpPort})...`);
					await wails.StartVoiceChat(host, udpPort, token, user.id);
					addLog('STEP 5: StartVoiceChat successful.');
				} else {
					addLog('STEP 5: FAILED (Method StartVoiceChat missing)');
					throw new Error('StartVoiceChat binding missing');
				}
				
				addLog('STEP 6: Waiting 150ms...');
				await new Promise(resolve => setTimeout(resolve, 150));
				
				if (wails?.JoinVoiceChannel) {
					await wails.JoinVoiceChannel(activeChannelId);
					addLog('Connected to voice channel.');
				}

				addLog('STEP 8: Initializing MediaStream...');
				const constraints: MediaStreamConstraints = { 
					audio: preferredMicId && preferredMicId !== 'default' 
						? { deviceId: { exact: preferredMicId } } 
						: true 
				};

				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				addLog('STEP 8: getUserMedia successful.');

				if (!isMounted) {
					stream.getTracks().forEach(t => t.stop());
					return;
				}
				streamRef.current = stream;

				addLog('STEP 9: Initializing AudioContext...');
				const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
				audioContextRef.current = audioCtx;
				if (audioCtx.state === 'suspended') {
					await audioCtx.resume();
				}
				addLog(`STEP 9: AudioContext ${audioCtx.state}`);

				const source = audioCtx.createMediaStreamSource(stream);
				const analyser = audioCtx.createAnalyser();
				analyser.fftSize = 256;
				source.connect(analyser);

				// Create global gain for remote audio
				const remoteGain = audioCtx.createGain();
				remoteGain.connect(audioCtx.destination);
				remoteGainRef.current = remoteGain;
				remoteGain.gain.value = isDeafened ? 0 : 1;
				
				
				addLog(`STEP 10: Starting MediaRecorder...`);

				// High-speed VAD loop for the UI indicator (Real-time)
				const updateUI = () => {
					if (!isMounted) return;
					const dataArray = new Uint8Array(analyser.frequencyBinCount);
					analyser.getByteFrequencyData(dataArray);
					const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

					const currentMuted = useVoiceStore.getState().isMuted;
					if (average > 20 && !currentMuted) { // Higher threshold, check mute
						markSpeaking(user.id);
						scheduleSpeakingClear(user.id, 200); // Fast fade-out (200ms)
					} else if (currentMuted) {
						// If muted, force clear speaking state immediately
						const currentSpeakers = useVoiceStore.getState().speakingUsers;
						if (currentSpeakers.has(user.id)) {
							const next = new Set(currentSpeakers);
							next.delete(user.id);
							_setInternalState({ speakingUsers: next });
							clearSpeakingTimeout(user.id);
						}
					}
					requestAnimationFrame(updateUI);
				};
				updateUI();
				
				addLog(`STEP 10: Using RAW PCM Pipeline (Safari/Mac optimized)`);
				
				// SENDER: Use ScriptProcessor for raw samples
				// 4096 samples at 44.1/48kHz is ~85-92ms
				// 2048 samples is ~42-46ms (Perfect for UDP)
				const bufferSize = 2048;
				const scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
				source.connect(scriptNode);
				scriptNode.connect(audioCtx.destination); // Required for onaudioprocess to trigger

				scriptNode.onaudioprocess = (e) => {
					if (!isActive || useVoiceStore.getState().isMuted) return;

					const inputData = e.inputBuffer.getChannelData(0);
					
					// VAD check on raw samples
					let sum = 0;
					for (let i = 0; i < inputData.length; i++) {
						sum += Math.abs(inputData[i]);
					}
					const average = sum / inputData.length;

					if (average > 0.01) { // Threshold for Float32 PCM
						// Convert Float32 to Int16 to save bandwidth (2 bytes per sample)
						const int16Data = new Int16Array(inputData.length);
						for (let i = 0; i < inputData.length; i++) {
							// Clamp and scale
							const s = Math.max(-1, Math.min(1, inputData[i]));
							int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
						}

						const currentWails = (window as any).go?.main?.App;
						if (currentWails?.SendVoiceAudio) {
							// Apply a very tiny fade to edges to prevent clicks
							if (int16Data.length > 100) {
								for (let i = 0; i < 50; i++) {
									const f = i / 50;
									int16Data[i] *= f;
									int16Data[int16Data.length - 1 - i] *= f;
								}
							}
							
							// Use Base64 for reliable binary transfer to Wails v2
							const uint8 = new Uint8Array(int16Data.buffer);
							const base64 = btoa(String.fromCharCode(...uint8));
							currentWails.SendVoiceAudio(base64);
						}
						
						// Update local UI
						markSpeaking(user.id);
						scheduleSpeakingClear(user.id, 200);
					}
				};

				addLog('Connected (PCM Mode).');
			} catch (err) {
				addLog(`CRITICAL ERROR: ${err}`);
				if (err instanceof Error) {
					addLog(`STACK: ${err.stack?.substring(0, 150)}`);
				}
				leaveVoice();
			}
		};

		const stop = () => {
			addLog(`STOP: Stopping voice chat... (isActive=${isActive}, mounted=${isMounted})`);
			speakingTimeoutsRef.current.forEach((id) => clearTimeout(id));
			speakingTimeoutsRef.current.clear();
			if (streamRef.current) {
				streamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
				streamRef.current = null;
			}
			if (audioContextRef.current) {
				audioContextRef.current.close();
				audioContextRef.current = null;
			}
			
			// DISCONNECT AND CLEAR REMOTE PLAYERS
			remotePlayersRef.current.forEach(p => {
				try { p.node.disconnect(); } catch { /* already disconnected */ }
			});
			remotePlayersRef.current.clear();
			remoteGainRef.current = null;
			
			const currentWails = (window as any).go?.main?.App;
			if (currentWails) {
				addLog('STOP: Sending Leave and Stop to Go...');
				currentWails.LeaveVoiceChannel();
				currentWails.StopVoiceChat();
			}
		};

		if (isActive) {
			start();
		} else {
			stop();
		}

		return () => {
			addLog('CLEANUP: Effect cleanup triggered');
			isMounted = false;
			stop();
		};
	}, [isActive, activeChannelId, user?.id, token, preferredMicId]);
	
	// Force clear local speaking state when muting
	useEffect(() => {
		if (isMuted && user?.id) {
			const current = useVoiceStore.getState().speakingUsers;
			if (current.has(user.id)) {
				const next = new Set(current);
				next.delete(user.id);
				_setInternalState({ speakingUsers: next });
			}
		}
	}, [isMuted, user?.id, _setInternalState]);
	
	// Update remote gain when deafened state changes
	useEffect(() => {
		if (remoteGainRef.current) {
			remoteGainRef.current.gain.setTargetAtTime(isDeafened ? 0 : 1, audioContextRef.current?.currentTime || 0, 0.1);
		}
	}, [isDeafened]);

	// Update individual user volumes and mutes
	const { userVolumes, userMutes } = useVoiceStore();
	useEffect(() => {
		remotePlayersRef.current.forEach((player, userId) => {
			const volume = userVolumes[userId] ?? 1;
			const isMuted = userMutes.has(userId);
			const targetGain = isMuted ? 0 : volume;
			player.gainNode.gain.setTargetAtTime(targetGain, audioContextRef.current?.currentTime || 0, 0.1);
		});
	}, [userVolumes, userMutes]);

	// Global AudioContext Resume on any click (Browsers/Wails often require this)
	useEffect(() => {
		const resume = async () => {
			if (audioContextRef.current?.state === 'suspended') {
				addLog('GESTURE: Resuming AudioContext...');
				await audioContextRef.current.resume();
				addLog(`GESTURE: Context state is now ${audioContextRef.current.state}`);
			}
		};
		window.addEventListener('mousedown', resume);
		window.addEventListener('keydown', resume);
		return () => {
			window.removeEventListener('mousedown', resume);
			window.removeEventListener('keydown', resume);
		};
	}, []);

	// Handle incoming audio
	useEffect(() => {
		if (!isWails() || !isActive) return;

		const handleAudioEvent = async (event: any) => {
			const currentDeafened = useVoiceStore.getState().isDeafened;
			if (currentDeafened || !audioContextRef.current) return;
			
			const { senderID, data } = event;
			if (senderID === user?.id) return;

			try {
				let uint8: Uint8Array;
				if (typeof data === 'string') {
					const bin = atob(data);
					uint8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
				} else {
					uint8 = new Uint8Array(data.buffer || data);
				}

				// Convert Int16 back to Float32
				const int16 = new Int16Array(uint8.buffer, uint8.byteOffset, uint8.byteLength / 2);
				const float32 = new Float32Array(int16.length);
				for (let i = 0; i < int16.length; i++) {
					float32[i] = int16[i] / 0x7FFF;
				}

				// Update speaking indicator
				markSpeaking(senderID);
				scheduleSpeakingClear(senderID, 300);

				// Playback via ScriptProcessor for smooth streaming
				let player = remotePlayersRef.current.get(senderID);
				if (!player) {
					const node = audioContextRef.current.createScriptProcessor(2048, 0, 1);
					const gainNode = audioContextRef.current.createGain();
					const queue: Float32Array[] = [];
					
					// Initial volume from store
					const vol = useVoiceStore.getState().userVolumes[senderID] ?? 1;
					const mut = useVoiceStore.getState().userMutes.has(senderID);
					gainNode.gain.value = mut ? 0 : vol;

					node.onaudioprocess = (e) => {
						const out = e.outputBuffer.getChannelData(0);
						if (queue.length > 0) {
							const chunk = queue.shift()!;
							out.set(chunk);
						} else {
							out.fill(0);
						}
					};
					
					node.connect(gainNode);
					if (remoteGainRef.current) {
						gainNode.connect(remoteGainRef.current);
					} else {
						gainNode.connect(audioContextRef.current.destination);
					}
					player = { node, gainNode, queue };
					remotePlayersRef.current.set(senderID, player);
				}
				
				// Limit queue size to prevent latency build-up
				if (player.queue.length < 10) {
					player.queue.push(float32);
				}
			} catch {
				// Log errors sparingly
			}
		};

		(window as any).runtime.EventsOn('voice:audio', handleAudioEvent);
		return () => (window as any).runtime.EventsOff('voice:audio');
	}, [isActive, isDeafened, _setInternalState]);


	// Listen for voice participant updates via WebSocket
	useEffect(() => {
		const unsub = onWS('voice_update', (payload: any) => {
			const { channel_id, users } = payload;
			console.log('VoiceChat: Received update for', channel_id, 'users:', users);
			useVoiceStore.getState().updateParticipants(channel_id, users);
		});
		return () => unsub();
	}, []);

	const participantsMap = useVoiceStore(state => state.participants);
	
	if (!isActive || !activeChannel) return null;

	const channelParticipants = participantsMap[activeChannelId || ''] || [];
	// Fallback: If we are active but not in the list yet (race condition), show at least ourselves
	const displayParticipants = channelParticipants.length > 0 
		? channelParticipants 
		: (user ? [user.id] : []);

	return (
		<VoiceChatPanel 
			isActive={isActive}
			isMuted={isMuted}
			isDeafened={isDeafened}
			speakingUsers={speakingUsers}
			onMuteToggle={() => _setInternalState({ isMuted: !isMuted })}
			onDeafenToggle={() => _setInternalState({ isDeafened: !isDeafened })}
			onDisconnect={leaveVoice}
			members={displayParticipants}
			memberAvatars={activeChannel.member_avatars || {}}
			memberNames={activeChannel.member_names || {}}
		/>
	);
};
