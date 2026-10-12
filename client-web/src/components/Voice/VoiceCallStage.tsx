import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
	Mic,
	MicOff,
	Video,
	VideoOff,
	Monitor,
	Volume2,
	VolumeX,
	PhoneOff,
	Maximize2,
	Minimize2,
	Settings2,
	Headphones,
	ChevronUp,
	ChevronDown,
	Check,
	Sliders,
	Ratio,
} from 'lucide-react';
import { Avatar } from '../Avatar';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	ContextMenuLabel,
} from '../ui/context-menu';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Slider } from '../ui/slider';
import { useVoiceStore } from '@/store/voiceStore';
import { useAuthStore, getChannelDisplayName } from '@/store/store';
import { webRTCManager } from '@/rtc/WebRTCManager';
import type { Channel } from '@/types/api';

interface VoiceCallStageProps {
	channel: Channel;
}

interface ScreenShareItem {
	id: string; // 'local' or remote userId
	userId: string;
	username: string;
	stream: MediaStream;
	isLocal: boolean;
}

/**
 * Dedicated video component that safely binds a MediaStream to an HTML video element.
 * Defaulting muted={true} guarantees instant autoplay under strict browser policies,
 * preventing the black-screen issue on live WebRTC tracks.
 */
const StreamVideo: React.FC<{
	stream: MediaStream;
	isLocal?: boolean;
	className?: string;
	objectFit?: 'cover' | 'contain';
	mirror?: boolean;
	onContextMenu?: React.MouseEventHandler;
}> = ({ stream, isLocal: _isLocal, className, objectFit = 'cover', mirror = false, onContextMenu }) => {
	const videoRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const el = videoRef.current;
		if (!el || !stream) return;

		el.srcObject = stream;

		const tryPlay = () => {
			const playPromise = el.play();
			if (playPromise !== undefined) {
				playPromise.catch(() => {
					/* Handled safely; muted prevents rejection */
				});
			}
		};

		tryPlay();
		el.onloadedmetadata = () => {
			tryPlay();
		};

		const videoTracks = stream.getVideoTracks();
		videoTracks.forEach((track) => {
			track.addEventListener('unmute', tryPlay);
		});

		return () => {
			videoTracks.forEach((track) => {
				track.removeEventListener('unmute', tryPlay);
			});
		};
	}, [stream]);

	return (
		<video
			ref={videoRef}
			autoPlay
			playsInline
			muted={true}
			onContextMenu={onContextMenu}
			className={`${className || 'w-full h-full'} ${
				objectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'
			} rounded-xl`}
			style={mirror ? { transform: 'scaleX(-1)' } : undefined}
		/>
	);
};

/**
 * Reusable Right-Click Context Menu for any shared screen (Spotlight or Card)
 * giving Discord-like individual volume control (0-200%), aspect mode, and focus.
 */
const ScreenContextMenu: React.FC<{
	screen: ScreenShareItem;
	isSpotlight: boolean;
	objectFit: 'contain' | 'cover';
	onToggleFit?: () => void;
	onSelectSpotlight: () => void;
	children: React.ReactNode;
}> = ({ screen, isSpotlight, objectFit, onToggleFit, onSelectSpotlight, children }) => {
	const screenShareVolumes = useVoiceStore((state) => state.screenShareVolumes);
	const screenShareMutes = useVoiceStore((state) => state.screenShareMutes);

	const volume = screenShareVolumes[screen.userId] ?? 1;
	const isMuted = !!screenShareMutes[screen.userId];

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild className="cursor-context-menu">
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent className="w-64 bg-[#111214] border-[#2b2d31] text-white shadow-2xl p-1.5 rounded-xl">
				<ContextMenuLabel className="flex items-center gap-2 text-white/90 text-xs font-semibold px-2 py-1.5">
					<Monitor size={14} className="text-[#23a55a]" />
					<span className="truncate">{screen.username}</span>
					<span className="ms-auto px-1.5 py-0.5 rounded bg-[#da373c] text-[9px] font-bold text-white uppercase tracking-wider">
						LIVE
					</span>
				</ContextMenuLabel>
				<ContextMenuSeparator className="bg-white/10" />

				{!screen.isLocal && (
					<>
						<div className="px-2.5 py-2">
							<div className="flex items-center justify-between mb-2">
								<span className="text-[11px] font-medium text-white/80">Stream Volume</span>
								<span className="text-[11px] font-bold text-[#23a55a] tabular-nums">
									{Math.round(volume * 100)}%
								</span>
							</div>
							<Slider
								value={[volume * 100]}
								min={0}
								max={200}
								step={1}
								onValueChange={(vals) =>
									webRTCManager.setScreenShareVolume(screen.userId, vals[0] / 100)
								}
								className="my-1"
							/>
						</div>
						<ContextMenuItem
							onClick={() => webRTCManager.toggleScreenShareMute(screen.userId)}
							className={`cursor-pointer px-2 py-1.5 rounded-md text-xs font-medium ${
								isMuted ? 'text-[#23a55a] hover:bg-[#23a55a]/15' : 'text-[#da373c] hover:bg-[#da373c]/15'
							}`}
						>
							{isMuted ? (
								<>
									<Volume2 className="me-2 h-3.5 w-3.5" />
									Unmute Stream Audio
								</>
							) : (
								<>
									<VolumeX className="me-2 h-3.5 w-3.5" />
									Mute Stream Audio
								</>
							)}
						</ContextMenuItem>
						<ContextMenuSeparator className="bg-white/10" />
					</>
				)}

				{!isSpotlight && (
					<ContextMenuItem
						onClick={onSelectSpotlight}
						className="cursor-pointer px-2 py-1.5 rounded-md text-xs text-white/90 hover:bg-[#2b2d31]"
					>
						<Maximize2 className="me-2 h-3.5 w-3.5 text-[#23a55a]" />
						Focus this Screen
					</ContextMenuItem>
				)}

				{onToggleFit && (
					<ContextMenuItem
						onClick={onToggleFit}
						className="cursor-pointer px-2 py-1.5 rounded-md text-xs text-white/90 hover:bg-[#2b2d31]"
					>
						<Ratio className="me-2 h-3.5 w-3.5 text-white/70" />
						{objectFit === 'contain' ? 'Fill Window (Crop)' : 'Fit to Window (Letterbox)'}
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
};

/**
 * Integrated Discord-style Call Stage embedded directly in the Chat layout.
 * Supports split chat view, multi-screen spotlighting, filmstrip cards,
 * configurable quality/aspect ratio, and per-stream volume control.
 */
export const VoiceCallStage: React.FC<VoiceCallStageProps> = ({ channel }) => {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [objectFit, setObjectFit] = useState<'contain' | 'cover'>('contain');
	const [stageHeight, setStageHeight] = useState<number>(() => {
		try {
			const saved = localStorage.getItem('nodetalk_call_stage_height');
			if (saved) {
				const parsed = parseInt(saved, 10);
				if (!isNaN(parsed) && parsed >= 200) return parsed;
			}
		} catch {
			/* ignore */
		}
		return 420;
	});

	const stageContainerRef = useRef<HTMLDivElement | null>(null);

	const currentUser = useAuthStore((state) => state.user);
	const isMuted = useVoiceStore((state) => state.isMuted);
	const isDeafened = useVoiceStore((state) => state.isDeafened);
	const isVideoEnabled = useVoiceStore((state) => state.isVideoEnabled);
	const isScreenSharing = useVoiceStore((state) => state.isScreenSharing);
	const speakingUsers = useVoiceStore((state) => state.speakingUsers);
	const localStream = useVoiceStore((state) => state.localStream);
	const localScreenStream = useVoiceStore((state) => state.localScreenStream);
	const remoteStreams = useVoiceStore((state) => state.remoteStreams);
	const remoteScreenStreams = useVoiceStore((state) => state.remoteScreenStreams);
	const participantTrackStates = useVoiceStore((state) => state.participantTrackStates);
	const spotlightStreamId = useVoiceStore((state) => state.spotlightStreamId);
	const setSpotlightStreamId = useVoiceStore((state) => state.setSpotlightStreamId);
	const screenShareSettings = useVoiceStore((state) => state.screenShareSettings);
	const userVolumes = useVoiceStore((state) => state.userVolumes);
	const userMutes = useVoiceStore((state) => state.userMutes);

	const rawParticipants = useVoiceStore((state) => state.participants[channel.id]);
	const currentUserId = currentUser?.id;

	// Guarantee current user is always included in active call roster
	const members = useMemo(() => {
		const set = new Set(rawParticipants ?? []);
		if (currentUserId) set.add(currentUserId);
		return Array.from(set);
	}, [rawParticipants, currentUserId]);

	// Collect all currently active screen share streams (local + remotes)
	const allScreenShares = useMemo<ScreenShareItem[]>(() => {
		const list: ScreenShareItem[] = [];

		if (isScreenSharing && localScreenStream && localScreenStream.getVideoTracks().length > 0) {
			list.push({
				id: 'local',
				userId: currentUser?.id || 'local',
				username: `${currentUser?.username || 'You'} (Your Screen)`,
				stream: localScreenStream,
				isLocal: true,
			});
		}

		for (const [uid, s] of Object.entries(remoteScreenStreams)) {
			if (s && s.getVideoTracks().length > 0) {
				list.push({
					id: uid,
					userId: uid,
					username: `${channel.member_names?.[uid] || `User ${uid.slice(0, 6)}`}'s Screen`,
					stream: s,
					isLocal: false,
				});
			}
		}

		return list;
	}, [
		isScreenSharing,
		localScreenStream,
		remoteScreenStreams,
		currentUser?.id,
		currentUser?.username,
		channel.member_names,
	]);

	// Determine the currently spotlighted screen
	const activeSpotlight = useMemo<ScreenShareItem | null>(() => {
		if (allScreenShares.length === 0) return null;
		if (spotlightStreamId) {
			const found = allScreenShares.find((item) => item.id === spotlightStreamId);
			if (found) return found;
		}
		// Default to first available screen share
		return allScreenShares[0];
	}, [allScreenShares, spotlightStreamId]);

	// Auto-request keyframes on all active remote screen shares to ensure instant decoding
	useEffect(() => {
		for (const share of allScreenShares) {
			if (!share.isLocal) {
				webRTCManager.requestKeyframe(share.userId);
			}
		}
	}, [allScreenShares]);

	const isSpotlightMuted = activeSpotlight
		? activeSpotlight.isLocal
			? isMuted
			: participantTrackStates[activeSpotlight.userId]
			? !participantTrackStates[activeSpotlight.userId].audio
			: false
		: false;

	const channelTitle = getChannelDisplayName(channel, currentUser?.id ?? '');

	const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		const startY = e.clientY;
		const startH = stageHeight;

		const onPointerMove = (moveEv: PointerEvent) => {
			const delta = moveEv.clientY - startY;
			const newHeight = Math.max(240, Math.min(window.innerHeight - 150, startH + delta));
			setStageHeight(newHeight);
		};

		const onPointerUp = (upEv: PointerEvent) => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			const delta = upEv.clientY - startY;
			const finalH = Math.max(240, Math.min(window.innerHeight - 150, startH + delta));
			try {
				localStorage.setItem('nodetalk_call_stage_height', String(finalH));
			} catch {
				/* ignore */
			}
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	};

	// Toggle true browser fullscreen
	const toggleFullscreen = () => {
		if (!stageContainerRef.current) return;
		if (!document.fullscreenElement) {
			stageContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {
				setIsFullscreen(!isFullscreen);
			});
		} else {
			document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {
				setIsFullscreen(false);
			});
		}
	};

	// If collapsed by user, render a sleek compact banner
	if (isCollapsed && !isFullscreen) {
		return (
			<div className="bg-[#18191c] border-b border-border/50 h-10 px-4 flex items-center justify-between text-white shrink-0 select-none animate-in fade-in duration-150">
				<div className="flex items-center gap-2 min-w-0">
					<span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse shrink-0" />
					<span className="text-xs font-semibold text-white/90 truncate">
						{channelTitle}
					</span>
					<span className="text-[11px] text-white/50 hidden sm:inline">
						({members.length} {members.length === 1 ? 'member' : 'members'})
					</span>
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setIsCollapsed(false)}
						className="px-2.5 py-1 rounded-md bg-[#2b2d31] hover:bg-[#35373c] text-white/90 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
					>
						<ChevronDown size={14} />
						<span>Show Call</span>
					</button>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={stageContainerRef}
			style={!isFullscreen ? { height: `${stageHeight}px` } : undefined}
			className={
				isFullscreen
					? 'fixed inset-0 z-50 bg-[#111214] flex flex-col overflow-hidden animate-in fade-in duration-200'
					: 'relative w-full bg-[#111214] border-b border-[#232428] flex flex-col overflow-hidden shrink-0 select-none transition-[height] duration-75'
			}
		>
			{/* Top Header of Call Stage */}
			<div className="h-11 px-4 flex items-center justify-between bg-[#18191c]/90 backdrop-blur-md border-b border-border/50 shrink-0 z-10 select-none">
				<div className="flex items-center gap-2.5 min-w-0">
					<span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] animate-pulse shrink-0 shadow-[0_0_8px_rgba(35,165,90,0.5)]" />
					<span className="text-sm font-semibold text-white/95 truncate">
						{channelTitle}
					</span>
					<span className="text-xs text-white/50 hidden sm:inline tabular-nums">
						({members.length} {members.length === 1 ? 'member' : 'members'})
					</span>
					{allScreenShares.length > 0 && (
						<span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#23a55a]/15 text-[#23a55a] border border-[#23a55a]/30">
							<Monitor size={11} />
							<span>{allScreenShares.length} Sharing</span>
						</span>
					)}
				</div>

				<div className="flex items-center gap-2 text-white/70">
					{/* Fullscreen Toggle */}
					<button
						type="button"
						onClick={toggleFullscreen}
						className="h-7 px-2 hover:bg-[#2b2d31] hover:text-white rounded-md transition-colors cursor-pointer flex items-center gap-1.5 text-xs text-white/80"
						title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Call'}
					>
						{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
						<span className="hidden sm:inline font-medium">
							{isFullscreen ? 'Exit' : 'Fullscreen'}
						</span>
					</button>

					{/* Collapse to Chat Toggle */}
					{!isFullscreen && (
						<button
							type="button"
							onClick={() => setIsCollapsed(true)}
							className="h-7 w-7 hover:bg-[#2b2d31] hover:text-white rounded-md transition-colors cursor-pointer flex items-center justify-center text-white/80"
							title="Minimize Call Stage"
						>
							<ChevronUp size={15} />
						</button>
					)}
				</div>
			</div>

			{/* Main Media Stage Area */}
			<div className="relative flex-1 p-2.5 flex flex-col gap-2 min-h-0 bg-[#111214] overflow-hidden">
				{/* 1. Primary Spotlight Screen Stage */}
				{activeSpotlight && (
					<div className="relative flex-1 min-h-0 bg-black rounded-2xl overflow-hidden border border-[#2b2d31] flex items-center justify-center shadow-2xl group">
						<ScreenContextMenu
							screen={activeSpotlight}
							isSpotlight={true}
							objectFit={objectFit}
							onToggleFit={() => setObjectFit(objectFit === 'contain' ? 'cover' : 'contain')}
							onSelectSpotlight={() => {}}
						>
							<div className="w-full h-full flex items-center justify-center">
								<StreamVideo
									stream={activeSpotlight.stream}
									isLocal={activeSpotlight.isLocal}
									mirror={false}
									objectFit={objectFit}
									className="w-full h-full"
								/>
							</div>
						</ScreenContextMenu>

						{/* Top Left Badge: Presenter Name & LIVE Status */}
						<div className="absolute top-3 start-3 px-2.5 py-1 rounded-lg bg-[#111214]/85 backdrop-blur-md text-[11px] font-semibold text-white border border-white/10 flex items-center gap-2 shadow-lg select-none pointer-events-none">
							<Monitor size={13} className="text-[#23a55a]" />
							<span>{activeSpotlight.username}</span>
							<span className="px-1.5 py-0.2 rounded bg-[#da373c] text-[9px] font-bold uppercase tracking-wider text-white shadow-sm">
								LIVE
							</span>
							{isSpotlightMuted && (
								<div className="text-[#da373c] shrink-0 flex items-center" title="Muted">
									<MicOff size={11} />
								</div>
							)}
						</div>

						{/* Top Right Controls Overlay: Fit Mode & Fullscreen */}
						<div className="absolute top-3 end-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-[#111214]/80 backdrop-blur-md p-1 rounded-lg border border-white/10 shadow-lg">
							<button
								type="button"
								onClick={() => setObjectFit(objectFit === 'contain' ? 'cover' : 'contain')}
								className="px-2 py-1 rounded hover:bg-[#2b2d31] text-[11px] font-medium text-white/90 flex items-center gap-1 cursor-pointer transition-colors"
								title={objectFit === 'contain' ? 'Fill Window' : 'Fit to Window'}
							>
								<Ratio size={12} />
								<span>{objectFit === 'contain' ? 'Fit' : 'Fill'}</span>
							</button>
							<button
								type="button"
								onClick={toggleFullscreen}
								className="p-1 rounded hover:bg-[#2b2d31] text-white/90 cursor-pointer transition-colors"
								title="Toggle Fullscreen"
							>
								<Maximize2 size={13} />
							</button>
						</div>
					</div>
				)}

				{/* 2. Participants Area: Filmstrip bottom cards when sharing screen, Grid otherwise */}
				<div
					className={
						activeSpotlight
							? 'w-full overflow-x-auto py-1.5 px-2 shrink-0 h-24 scrollbar-thin flex justify-center items-center'
							: 'flex-1 min-h-0 w-full flex items-center justify-center p-2 overflow-hidden'
					}
				>
					<div
						className={
							activeSpotlight
								? 'flex items-center gap-2 min-w-fit mx-auto'
								: members.length <= 2
								? 'w-full h-full max-h-full flex items-center justify-center gap-3 sm:gap-4 overflow-hidden'
								: members.length <= 4
								? 'w-full h-full max-h-full grid grid-cols-2 gap-2.5 sm:gap-3 items-center justify-items-center overflow-hidden'
								: 'w-full h-full max-h-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 items-center justify-items-center overflow-y-auto'
						}
					>
						{members.map((userId) => {
							const isMe = userId === currentUser?.id;
							const isSpeaking = speakingUsers.has(userId);
							const isLocalMuted = userMutes.has(userId);
							const volume = userVolumes[userId] ?? 1;

							const isUserMuted = isMe
								? isMuted
								: participantTrackStates[userId]
								? !participantTrackStates[userId].audio
								: false;

							// Check if this participant is sharing their screen
							const userScreen = allScreenShares.find((item) =>
								isMe ? item.id === 'local' : item.userId === userId
							);
							const isScreenSpotlighted = userScreen && activeSpotlight?.id === userScreen.id;

							// Camera stream
							const camStream = isMe
								? isVideoEnabled && localStream
									? localStream
									: null
								: participantTrackStates[userId]?.video && remoteStreams[userId]
								? remoteStreams[userId]
								: null;

							const hasCamVideo = !!(camStream && camStream.getVideoTracks().length > 0);

							const tileContent = (
								<div
									onClick={() => {
										if (userScreen) {
											setSpotlightStreamId(userScreen.id);
										}
									}}
									className={`group relative flex flex-col items-center justify-center transition-all duration-150 overflow-hidden bg-[#2b2d31] select-none cursor-pointer ${
										activeSpotlight
											? 'w-32 sm:w-36 h-20 shrink-0 rounded-xl'
											: members.length === 1
											? 'h-full max-h-full aspect-[4/3] sm:aspect-video max-w-2xl w-auto rounded-2xl'
											: members.length === 2
											? 'h-full max-h-full aspect-[4/3] sm:aspect-video max-w-[calc(50%-0.5rem)] w-auto rounded-2xl'
											: members.length <= 4
											? 'w-full h-full max-h-full aspect-[4/3] sm:aspect-video justify-self-center self-center rounded-2xl'
											: 'w-full h-full max-h-full aspect-[4/3] sm:aspect-video justify-self-center self-center rounded-xl'
									} ${
										isScreenSpotlighted
											? 'border-2 border-[#23a55a] shadow-[0_0_14px_rgba(35,165,90,0.5)]'
											: isSpeaking
											? 'border-2 border-[#23a55a] shadow-[0_0_10px_rgba(35,165,90,0.35)]'
											: 'border border-white/5 hover:border-white/20'
									}`}
								>
									{/* Card Content Priority: Screen Preview > Camera Video > Avatar */}
									{userScreen && !isScreenSpotlighted ? (
										<StreamVideo
											stream={userScreen.stream}
											isLocal={userScreen.isLocal}
											mirror={false}
											className="w-full h-full object-cover"
										/>
									) : hasCamVideo ? (
										<StreamVideo
											stream={camStream}
											isLocal={isMe}
											mirror={isMe}
											className="w-full h-full object-cover"
										/>
									) : (
										<div className="relative w-full h-full flex flex-col items-center justify-center">
											<div className="relative">
												<div
													className={`rounded-full transition-all duration-150 ${
														isSpeaking
															? 'ring-3 ring-[#23a55a] shadow-[0_0_14px_rgba(35,165,90,0.65)]'
															: ''
													}`}
												>
													<Avatar
														userId={userId}
														avatarId={channel.member_avatars?.[userId]}
														size={
															activeSpotlight
																? 38
																: isFullscreen
																? 96
																: stageHeight < 280
																? 44
																: stageHeight < 360
																? 56
																: members.length <= 2
																? 72
																: 56
														}
													/>
												</div>
											</div>
										</div>
									)}

									{/* Top Right LIVE badge on card if sharing screen */}
									{userScreen && (
										<div className="absolute top-1.5 end-1.5 px-1.5 py-0.5 rounded bg-[#da373c] text-[8px] font-bold uppercase tracking-wider text-white shadow-md flex items-center gap-1">
											<Monitor size={9} />
											<span>LIVE</span>
										</div>
									)}

									{/* Bottom-Left User Name Badge */}
									<div className="absolute bottom-1.5 start-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#111214]/85 backdrop-blur-md text-[10px] font-semibold text-white/95 shadow-md pointer-events-none max-w-[85%] border border-white/5">
										<span className="truncate">
											{channel.member_names?.[userId] ||
												(isMe ? currentUser?.username : `User ${userId.slice(0, 6)}`)}
											{isMe && ' (You)'}
										</span>

										{isUserMuted && (
											<div className="text-[#da373c] shrink-0" title="Muted">
												<MicOff size={10} />
											</div>
										)}
										{isMe && isDeafened && (
											<div className="text-[#da373c] shrink-0" title="Deafened">
												<Headphones size={10} />
											</div>
										)}
										{isLocalMuted && (
											<div className="text-[#da373c] shrink-0" title="Muted locally">
												<VolumeX size={10} />
											</div>
										)}
									</div>
								</div>
							);

							// If user is sharing screen, wrap card in ScreenContextMenu for volume control!
							if (userScreen) {
								return (
									<ScreenContextMenu
										key={`screen-${userId}`}
										screen={userScreen}
										isSpotlight={!!isScreenSpotlighted}
										objectFit={objectFit}
										onSelectSpotlight={() => setSpotlightStreamId(userScreen.id)}
									>
										{tileContent}
									</ScreenContextMenu>
								);
							}

							if (isMe) {
								return (
									<React.Fragment key={userId}>
										{tileContent}
									</React.Fragment>
								);
							}

							// Standard participant audio context menu
							return (
								<ContextMenu key={userId}>
									<ContextMenuTrigger asChild className="cursor-context-menu">
										{tileContent}
									</ContextMenuTrigger>
									<ContextMenuContent className="w-60 bg-[#111214] border-[#2b2d31] text-white">
										<ContextMenuLabel className="flex items-center gap-2 text-white/90">
											<Settings2 size={14} className="text-[#23a55a]" />
											{channel.member_names?.[userId] || `User ${userId.slice(0, 6)}`}
										</ContextMenuLabel>
										<ContextMenuSeparator className="bg-white/10" />
										<div className="px-3 py-2.5">
											<div className="flex items-center justify-between mb-2">
												<span className="text-xs font-medium text-white/80">User Volume</span>
												<span className="text-[11px] font-bold text-[#23a55a] tabular-nums">
													{Math.round(volume * 100)}%
												</span>
											</div>
											<Slider
												value={[volume * 100]}
												min={0}
												max={200}
												step={1}
												onValueChange={(vals) =>
													webRTCManager.setParticipantVolume(userId, vals[0] / 100)
												}
											/>
										</div>
										<ContextMenuSeparator className="bg-white/10" />
										<ContextMenuItem
											onClick={() => webRTCManager.toggleParticipantMute(userId)}
											className={`cursor-pointer ${isLocalMuted ? 'text-[#23a55a]' : 'text-[#da373c]'}`}
										>
											{isLocalMuted ? (
												<>
													<Volume2 className="me-2 h-4 w-4" />
													Unmute for me
												</>
											) : (
												<>
													<VolumeX className="me-2 h-4 w-4" />
													Mute for me
												</>
											)}
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							);
						})}
					</div>
				</div>

				{/* 3. Discord Floating Bottom Pill Dock */}
				<div className="w-full flex items-center justify-center shrink-0 pt-1 pb-1">
					<div className="bg-[#1e1f22]/95 backdrop-blur-md rounded-2xl px-5 py-2 shadow-2xl border border-white/10 flex items-center justify-center gap-3.5 z-20">
						{/* Camera Toggle Button */}
						<button
							type="button"
							onClick={() => webRTCManager.toggleVideo()}
							className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isVideoEnabled
									? 'bg-white text-[#111214] hover:bg-white/90 shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
						>
							{isVideoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
						</button>

						{/* Screen Share Dropdown Button with Configurable Quality Menu */}
						<div className="flex items-center">
							<button
								type="button"
								onClick={() => webRTCManager.toggleScreenShare()}
								className={`h-10 px-3 rounded-s-full flex items-center gap-1.5 transition-all duration-150 cursor-pointer ${
									isScreenSharing
										? 'bg-[#23a55a] text-white hover:bg-[#1f9250] shadow-md'
										: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
								}`}
								title={isScreenSharing ? 'Stop Screen Share' : 'Share Your Screen'}
							>
								<Monitor size={18} />
								<span className="text-xs font-semibold hidden md:inline">
									{isScreenSharing ? 'Streaming' : 'Share'}
								</span>
							</button>

							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										className={`h-10 px-1.5 rounded-e-full border-s border-white/10 flex items-center justify-center transition-all duration-150 cursor-pointer ${
											isScreenSharing
												? 'bg-[#23a55a] text-white hover:bg-[#1f9250]'
												: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
										}`}
										title="Stream Quality & Settings"
									>
										<ChevronUp size={14} />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="center"
									side="top"
									className="w-72 bg-[#111214] border-[#2b2d31] text-white p-2.5 rounded-2xl shadow-2xl mb-2"
								>
									<DropdownMenuLabel className="flex items-center justify-between text-xs font-bold text-white px-2 py-1">
										<div className="flex items-center gap-2">
											<Sliders size={14} className="text-[#23a55a]" />
											<span>Stream Settings</span>
										</div>
										{isScreenSharing && (
											<span className="px-1.5 py-0.5 rounded bg-[#da373c] text-[9px] font-bold uppercase tracking-wider text-white">
												LIVE
											</span>
										)}
									</DropdownMenuLabel>
									<DropdownMenuSeparator className="bg-white/10 my-1.5" />

									{/* Resolution Selection */}
									<div className="px-2 py-1">
										<span className="text-[11px] font-medium text-white/60 block mb-1.5">
											Resolution
										</span>
										<div className="grid grid-cols-2 gap-1">
											{(['720p', '1080p', '1440p', 'source'] as const).map((res) => (
												<button
													key={res}
													type="button"
													onClick={() => {
														webRTCManager.applyScreenShareConstraints({ resolution: res });
													}}
													className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center justify-between transition-colors cursor-pointer ${
														screenShareSettings.resolution === res
															? 'bg-[#23a55a] text-white'
															: 'bg-[#2b2d31] text-white/80 hover:bg-[#35373c]'
													}`}
												>
													<span>{res.toUpperCase()}</span>
													{screenShareSettings.resolution === res && <Check size={12} />}
												</button>
											))}
										</div>
									</div>

									{/* Frame Rate Selection */}
									<div className="px-2 py-1.5">
										<span className="text-[11px] font-medium text-white/60 block mb-1.5">
											Frame Rate
										</span>
										<div className="grid grid-cols-3 gap-1">
											{([15, 30, 60] as const).map((fps) => (
												<button
													key={fps}
													type="button"
													onClick={() => {
														webRTCManager.applyScreenShareConstraints({ frameRate: fps });
													}}
													className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
														screenShareSettings.frameRate === fps
															? 'bg-[#23a55a] text-white'
															: 'bg-[#2b2d31] text-white/80 hover:bg-[#35373c]'
													}`}
												>
													<span>{fps} FPS</span>
												</button>
											))}
										</div>
									</div>

									{/* Aspect Ratio Selection */}
									<div className="px-2 py-1.5">
										<span className="text-[11px] font-medium text-white/60 block mb-1.5">
											Aspect Ratio
										</span>
										<div className="grid grid-cols-3 gap-1">
											{([
												{ key: 'source', label: 'Source' },
												{ key: '16/9', label: '16:9' },
												{ key: '4/3', label: '4:3' },
											] as const).map((item) => (
												<button
													key={item.key}
													type="button"
													onClick={() => {
														webRTCManager.applyScreenShareConstraints({ aspectRatio: item.key });
													}}
													className={`px-1.5 py-1 rounded-md text-[11px] font-semibold flex items-center justify-center transition-colors cursor-pointer ${
														screenShareSettings.aspectRatio === item.key
															? 'bg-[#23a55a] text-white'
															: 'bg-[#2b2d31] text-white/80 hover:bg-[#35373c]'
													}`}
												>
													<span>{item.label}</span>
												</button>
											))}
										</div>
									</div>

									{/* Content Hint */}
									<div className="px-2 py-1.5">
										<span className="text-[11px] font-medium text-white/60 block mb-1.5">
											Optimization
										</span>
										<div className="grid grid-cols-2 gap-1">
											<button
												type="button"
												onClick={() => {
													webRTCManager.applyScreenShareConstraints({ contentHint: 'detail' });
												}}
												className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center justify-center transition-colors cursor-pointer ${
													screenShareSettings.contentHint === 'detail'
														? 'bg-[#23a55a] text-white'
														: 'bg-[#2b2d31] text-white/80 hover:bg-[#35373c]'
												}`}
											>
												Text / Detail
											</button>
											<button
												type="button"
												onClick={() => {
													webRTCManager.applyScreenShareConstraints({ contentHint: 'motion' });
												}}
												className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center justify-center transition-colors cursor-pointer ${
													screenShareSettings.contentHint === 'motion'
														? 'bg-[#23a55a] text-white'
														: 'bg-[#2b2d31] text-white/80 hover:bg-[#35373c]'
												}`}
											>
												Motion / Video
											</button>
										</div>
									</div>

									<DropdownMenuSeparator className="bg-white/10 my-1.5" />

									{/* Action Footer Button */}
									<button
										type="button"
										onClick={() => webRTCManager.toggleScreenShare()}
										className={`w-full py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
											isScreenSharing
												? 'bg-[#da373c] text-white hover:bg-[#be3135]'
												: 'bg-[#23a55a] text-white hover:bg-[#1f9250]'
										}`}
									>
										{isScreenSharing ? 'Stop Screen Sharing' : 'Start Sharing with Settings'}
									</button>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>

						{/* Mic Mute/Unmute Button */}
						<button
							type="button"
							onClick={() => webRTCManager.toggleMute()}
							className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isMuted
									? 'bg-[#da373c] text-white hover:bg-[#be3135] shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
						>
							{isMuted ? <MicOff size={18} /> : <Mic size={18} />}
						</button>

						<div className="w-px h-5 bg-white/10 mx-0.5" />

						{/* Disconnect Button (Discord Red) */}
						<button
							type="button"
							onClick={() => webRTCManager.leave()}
							className="w-10 h-10 rounded-full bg-[#da373c] hover:bg-[#be3135] text-white shadow-lg flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
							title="Disconnect"
						>
							<PhoneOff size={18} />
						</button>
					</div>
				</div>
			</div>

			{/* Resizable Bottom Border Handle */}
			{!isFullscreen && (
				<div
					onPointerDown={handleResizeStart}
					className="h-2 w-full bg-transparent hover:bg-[#5865F2]/25 active:bg-[#5865F2]/50 cursor-row-resize transition-colors flex items-center justify-center group"
					title="Drag to resize stage"
				>
					<div className="w-12 h-1 rounded-full bg-white/20 group-hover:bg-[#5865F2] transition-colors" />
				</div>
			)}
		</div>
	);
};
