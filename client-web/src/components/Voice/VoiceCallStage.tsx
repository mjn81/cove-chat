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
import { Slider } from '../ui/slider';
import { useVoiceStore } from '@/store/voiceStore';
import { useAuthStore, getChannelDisplayName } from '@/store/store';
import { webRTCManager } from '@/rtc/WebRTCManager';
import type { Channel } from '@/types/api';

interface VoiceCallStageProps {
	channel: Channel;
}

/**
 * Dedicated video component that safely binds a MediaStream to an HTML video element.
 */
const StreamVideo: React.FC<{
	stream: MediaStream;
	isLocal?: boolean;
	className?: string;
	objectFit?: 'cover' | 'contain';
}> = ({ stream, isLocal, className, objectFit = 'cover' }) => {
	const videoRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const el = videoRef.current;
		if (el && stream) {
			el.srcObject = stream;
			el.play().catch(() => {});
		}
	}, [stream]);

	return (
		<video
			ref={videoRef}
			autoPlay
			playsInline
			muted={isLocal}
			className={`${className || 'w-full h-full'} ${
				objectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'
			} rounded-2xl`}
			style={isLocal ? { transform: 'scaleX(-1)' } : undefined}
		/>
	);
};

/**
 * Integrated Discord-style Call Stage embedded directly in the Chat layout.
 * Supports split chat view and fullscreen view (Requirement C).
 */
export const VoiceCallStage: React.FC<VoiceCallStageProps> = ({ channel }) => {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isCollapsed, setIsCollapsed] = useState(false);
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
		return 400;
	});

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
	const activePresenterId = useVoiceStore((state) => state.activePresenterId);
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

	// Robust screen share stream detection
	const activeScreenStream = useMemo(() => {
		if (isScreenSharing && localScreenStream) {
			return localScreenStream;
		}
		if (activePresenterId && remoteScreenStreams[activePresenterId]) {
			return remoteScreenStreams[activePresenterId];
		}
		// Fallback: if any remote user has a registered screen stream
		for (const s of Object.values(remoteScreenStreams)) {
			if (s && s.getVideoTracks().length > 0) return s;
		}
		// Fallback 2: if a remote user has screen track state active and remote stream exists
		if (
			activePresenterId &&
			participantTrackStates[activePresenterId]?.screen &&
			remoteStreams[activePresenterId]
		) {
			return remoteStreams[activePresenterId];
		}
		return null;
	}, [
		isScreenSharing,
		localScreenStream,
		activePresenterId,
		remoteScreenStreams,
		participantTrackStates,
		remoteStreams,
	]);

	const presenterName = useMemo(() => {
		if (!activeScreenStream) return null;
		if (isScreenSharing && localScreenStream === activeScreenStream) {
			return `${currentUser?.username || 'You'} (Your Screen)`;
		}
		if (activePresenterId) {
			return `${channel.member_names?.[activePresenterId] || `User ${activePresenterId.slice(0, 6)}`}'s Screen`;
		}
		return 'Shared Screen';
	}, [
		activeScreenStream,
		isScreenSharing,
		localScreenStream,
		currentUser,
		activePresenterId,
		channel.member_names,
	]);

	const channelTitle = getChannelDisplayName(channel, currentUser?.id ?? '');

	const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		const startY = e.clientY;
		const startH = stageHeight;

		const onPointerMove = (moveEv: PointerEvent) => {
			const delta = moveEv.clientY - startY;
			const newHeight = Math.max(220, Math.min(window.innerHeight - 150, startH + delta));
			setStageHeight(newHeight);
		};

		const onPointerUp = (upEv: PointerEvent) => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			const delta = upEv.clientY - startY;
			const finalH = Math.max(220, Math.min(window.innerHeight - 150, startH + delta));
			try {
				localStorage.setItem('nodetalk_call_stage_height', String(finalH));
			} catch {
				/* ignore */
			}
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
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
			style={!isFullscreen ? { height: `${stageHeight}px` } : undefined}
			className={
				isFullscreen
					? 'absolute inset-0 z-40 bg-[#111214] flex flex-col overflow-hidden animate-in fade-in duration-200'
					: 'relative w-full bg-[#111214] border-b border-[#232428] flex flex-col overflow-hidden shrink-0 select-none transition-[height] duration-75'
			}
		>
			{/* Leveled Top Header of Call Stage (Matches standard h-12 app header) */}
			<div className="h-12 px-4 flex items-center justify-between bg-[#18191c]/90 backdrop-blur-md border-b border-border/50 shrink-0 z-10 select-none">
				<div className="flex items-center gap-2.5 min-w-0">
					<span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] animate-pulse shrink-0 shadow-[0_0_8px_rgba(35,165,90,0.5)]" />
					<span className="text-sm font-semibold text-white/95 truncate">
						{channelTitle}
					</span>
					<span className="text-xs text-white/50 hidden sm:inline tabular-nums">
						({members.length} {members.length === 1 ? 'member' : 'members'})
					</span>
					<span className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#23a55a]/15 text-[#23a55a] border border-[#23a55a]/30">
						Connected
					</span>
				</div>

				<div className="flex items-center gap-2 text-white/70">
					{/* Fullscreen Toggle */}
					<button
						type="button"
						onClick={() => setIsFullscreen(!isFullscreen)}
						className="h-8 px-2.5 hover:bg-[#2b2d31] hover:text-white rounded-md transition-colors cursor-pointer flex items-center gap-1.5 text-xs text-white/80"
						title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Call'}
					>
						{isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
						<span className="hidden sm:inline font-medium">
							{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
						</span>
					</button>

					{/* Collapse to Chat Toggle */}
					{!isFullscreen && (
						<button
							type="button"
							onClick={() => setIsCollapsed(true)}
							className="h-8 w-8 hover:bg-[#2b2d31] hover:text-white rounded-md transition-colors cursor-pointer flex items-center justify-center text-white/80"
							title="Minimize Call Stage"
						>
							<ChevronUp size={16} />
						</button>
					)}
				</div>
			</div>

			{/* Main Media Stage Area */}
			<div className="relative flex-1 p-3 flex flex-col gap-2.5 min-h-0 bg-[#111214] overflow-hidden">
				{/* Screen Share Spotlight (Prominent Display) */}
				{activeScreenStream && (
					<div className="relative flex-1 min-h-0 bg-black rounded-xl overflow-hidden border border-[#2b2d31] flex items-center justify-center shadow-xl">
						<StreamVideo
							stream={activeScreenStream}
							isLocal={false}
							objectFit="contain"
							className="w-full h-full"
						/>
						{presenterName && (
							<div className="absolute top-2.5 start-2.5 px-2.5 py-1 rounded-md bg-[#111214]/85 backdrop-blur-md text-[11px] font-semibold text-white border border-white/10 flex items-center gap-1.5 shadow-md">
								<Monitor size={13} className="text-[#23a55a]" />
								<span>{presenterName}</span>
								<span className="px-1.5 py-0.2 rounded bg-[#da373c] text-[9px] font-bold uppercase tracking-wider text-white">
									LIVE
								</span>
							</div>
						)}
					</div>
				)}

				{/* Discord Participants Area (Filmstrip when sharing screen, Grid otherwise) */}
				<div
					className={
						activeScreenStream
							? 'flex gap-2 overflow-x-auto py-1 px-1 shrink-0 h-22 scrollbar-thin'
							: 'flex-1 flex items-center justify-center gap-4 flex-wrap overflow-y-auto p-2'
					}
				>
					{members.map((userId) => {
						const isMe = userId === currentUser?.id;
						const isSpeaking = speakingUsers.has(userId);
						const isLocalMuted = userMutes.has(userId);
						const volume = userVolumes[userId] ?? 1;

						// Determine video stream
						const stream = isMe
							? isVideoEnabled && localStream
								? localStream
								: null
							: participantTrackStates[userId]?.video && remoteStreams[userId]
							? remoteStreams[userId]
							: null;

						const hasVideoTrack = !!(stream && stream.getVideoTracks().length > 0);

						const tileContent = (
							<div
								className={`group relative flex flex-col items-center justify-center rounded-xl transition-all duration-150 overflow-hidden bg-[#2b2d31] select-none ${
									activeScreenStream
										? 'w-28 sm:w-32 h-20 shrink-0'
										: members.length <= 2
										? 'w-48 sm:w-56 h-48 sm:h-56'
										: members.length <= 4
										? 'w-40 sm:w-44 h-40 sm:h-44'
										: 'w-32 sm:w-36 h-32 sm:h-36'
								} ${
									isSpeaking
										? 'border-2 border-[#23a55a] shadow-[0_0_12px_rgba(35,165,90,0.35)]'
										: 'border border-white/5 hover:border-white/10'
								}`}
							>
								{hasVideoTrack ? (
									<StreamVideo
										stream={stream}
										isLocal={isMe}
										className="w-full h-full object-cover"
									/>
								) : (
									<div className="relative flex flex-col items-center justify-center">
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
														activeScreenStream
															? 34
															: members.length <= 2
															? isFullscreen
																? 96
																: 72
															: 56
													}
												/>
											</div>
										</div>
									</div>
								)}

								{/* Bottom-Left User Name Badge */}
								<div className="absolute bottom-1.5 start-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#111214]/85 backdrop-blur-md text-[10px] font-semibold text-white/95 shadow-md pointer-events-none max-w-[90%] border border-white/5">
									<span className="truncate">
										{channel.member_names?.[userId] ||
											(isMe ? currentUser?.username : `User ${userId.slice(0, 6)}`)}
										{isMe && ' (You)'}
									</span>

									{isMe && isMuted && (
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

						if (isMe) {
							return <div key={userId}>{tileContent}</div>;
						}

						return (
							<ContextMenu key={userId}>
								<ContextMenuTrigger className="cursor-context-menu">
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

				{/* Discord Floating Bottom Pill Dock */}
				<div className="w-full flex items-center justify-center shrink-0 pt-1 pb-1">
					<div className="bg-[#1e1f22]/95 backdrop-blur-md rounded-2xl px-5 py-2.5 shadow-2xl border border-white/10 flex items-center justify-center gap-3.5 z-20">
						{/* Camera Toggle Button */}
						<button
							type="button"
							onClick={() => webRTCManager.toggleVideo()}
							className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isVideoEnabled
									? 'bg-white text-[#111214] hover:bg-white/90 shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
						>
							{isVideoEnabled ? <Video size={19} /> : <VideoOff size={19} />}
						</button>

						{/* Screen Share Button */}
						<button
							type="button"
							onClick={() => webRTCManager.toggleScreenShare()}
							className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isScreenSharing
									? 'bg-[#23a55a] text-white hover:bg-[#1f9250] shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isScreenSharing ? 'Stop Screen Share' : 'Share Your Screen'}
						>
							<Monitor size={19} />
						</button>

						{/* Mic Mute/Unmute Button */}
						<button
							type="button"
							onClick={() => webRTCManager.toggleMute()}
							className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isMuted
									? 'bg-[#da373c] text-white hover:bg-[#be3135] shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
						>
							{isMuted ? <MicOff size={19} /> : <Mic size={19} />}
						</button>

						<div className="w-px h-6 bg-white/10 mx-0.5" />

						{/* Disconnect Button (Discord Red) */}
						<button
							type="button"
							onClick={() => webRTCManager.leave()}
							className="w-11 h-11 rounded-full bg-[#da373c] hover:bg-[#be3135] text-white shadow-lg flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
							title="Disconnect"
						>
							<PhoneOff size={19} />
						</button>
					</div>
				</div>
			</div>

			{/* Resizable Bottom Border Handle (Drag like sidebar) */}
			{!isFullscreen && (
				<div
					onPointerDown={handleResizeStart}
					className="group absolute bottom-0 inset-x-0 h-2.5 cursor-row-resize flex items-center justify-center z-30 select-none touch-none hover:bg-primary/20 transition-colors"
					title="Drag to resize call area"
				>
					<div className="w-12 h-1 rounded-full bg-white/20 group-hover:bg-primary transition-colors" />
				</div>
			)}
		</div>
	);
};
