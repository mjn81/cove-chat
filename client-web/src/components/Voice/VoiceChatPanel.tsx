import React, { useRef, useEffect, useState } from 'react';
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
	Radio,
	Headphones,
	Wifi,
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
import { useAuthStore } from '@/store/store';
import { webRTCManager } from '@/rtc/WebRTCManager';

interface VoiceChatPanelProps {
	isActive: boolean;
	isMuted: boolean;
	isDeafened: boolean;
	speakingUsers: Set<string>;
	onMuteToggle: () => void;
	onDeafenToggle: () => void;
	onDisconnect: () => void;
	members: string[];
	memberAvatars: Record<string, string>;
	memberNames: Record<string, string>;
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
			el.play().catch(() => {
				/* Browser autoplay policies may block audio, video will still play inline */
			});
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

export const VoiceChatPanel: React.FC<VoiceChatPanelProps> = ({
	isActive,
	isMuted,
	isDeafened,
	speakingUsers,
	onMuteToggle,
	onDeafenToggle,
	onDisconnect,
	members,
	memberAvatars,
	memberNames,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const currentUser = useAuthStore((state) => state.user);

	const isVideoEnabled = useVoiceStore((state) => state.isVideoEnabled);
	const isScreenSharing = useVoiceStore((state) => state.isScreenSharing);
	const localStream = useVoiceStore((state) => state.localStream);
	const localScreenStream = useVoiceStore((state) => state.localScreenStream);
	const remoteStreams = useVoiceStore((state) => state.remoteStreams);
	const remoteScreenStreams = useVoiceStore((state) => state.remoteScreenStreams);
	const participantTrackStates = useVoiceStore((state) => state.participantTrackStates);
	const activePresenterId = useVoiceStore((state) => state.activePresenterId);
	const userVolumes = useVoiceStore((state) => state.userVolumes);
	const userMutes = useVoiceStore((state) => state.userMutes);

	if (!isActive) return null;

	// Check if someone (local or remote) is sharing screen
	const activeScreenStream =
		isScreenSharing && localScreenStream
			? localScreenStream
			: activePresenterId && remoteScreenStreams[activePresenterId]
			? remoteScreenStreams[activePresenterId]
			: null;

	const presenterName =
		activeScreenStream && isScreenSharing
			? `${currentUser?.username || 'You'} (Your Screen)`
			: activePresenterId
			? `${memberNames[activePresenterId] || `User ${activePresenterId.slice(0, 6)}`}'s Screen`
			: null;

	// Grid column layout matching Discord's adaptive call layout
	const totalTiles = members.length;
	const gridCols =
		totalTiles <= 1
			? 'grid-cols-1'
			: totalTiles <= 2
			? 'grid-cols-1 sm:grid-cols-2'
			: totalTiles <= 4
			? 'grid-cols-2'
			: totalTiles <= 6
			? 'grid-cols-2 sm:grid-cols-3'
			: 'grid-cols-2 sm:grid-cols-4';

	return (
		<div
			className={`fixed transition-all duration-300 ease-in-out z-50 flex flex-col bg-[#111214] border border-[#232428] shadow-[0_12px_48px_rgba(0,0,0,0.8)] overflow-hidden ${
				isExpanded
					? 'inset-3 sm:inset-6 rounded-3xl'
					: 'bottom-6 end-6 w-[380px] sm:w-[460px] h-[580px] rounded-2xl'
			}`}
		>
			{/* Dedicated Hidden Audio Elements mounted in DOM for zero-failure remote audio playback */}
			{members
				.filter((uid) => uid !== currentUser?.id)
				.map((uid) => {
					const stream = remoteStreams[uid];
					return (
						<audio
							key={uid}
							ref={(el) => {
								if (el && stream && el.srcObject !== stream) {
									el.srcObject = stream;
									el.play().catch(() => {});
								}
							}}
							autoPlay
							playsInline
							className="hidden"
						/>
					);
				})}

			{/* Discord Top Header */}
			<div className="px-4 py-3 flex items-center justify-between border-b border-white/5 bg-[#18191c] shrink-0 select-none">
				<div className="flex items-center gap-2.5">
					<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#23a55a]/15 text-[#23a55a] border border-[#23a55a]/30">
						<Radio size={12} className="animate-pulse" />
						<span className="text-[11px] font-bold tracking-wide uppercase">Voice Connected</span>
					</div>
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Wifi size={13} className="text-[#23a55a]" />
						<span className="font-medium text-white/80">
							{members.length} {members.length === 1 ? 'member' : 'members'}
						</span>
					</div>
				</div>

				<div className="flex items-center gap-1 text-white/70">
					<button
						type="button"
						onClick={() => setIsExpanded(!isExpanded)}
						className="p-1.5 hover:bg-[#2b2d31] hover:text-white rounded-lg transition-colors cursor-pointer"
						title={isExpanded ? 'Restore' : 'Maximize'}
					>
						{isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
					</button>
					<button
						type="button"
						onClick={onDisconnect}
						className="p-1.5 hover:bg-[#da373c]/20 hover:text-[#da373c] rounded-lg transition-colors cursor-pointer"
						title="Disconnect"
					>
						<PhoneOff size={16} />
					</button>
				</div>
			</div>

			{/* Discord Main Stage / Grid */}
			<div className="relative flex-1 p-3.5 flex flex-col gap-3 min-h-0 bg-[#111214] overflow-hidden">
				{/* Screen Share Spotlight (if active) */}
				{activeScreenStream && (
					<div className="relative flex-1 min-h-[220px] bg-black rounded-2xl overflow-hidden border border-[#2b2d31] flex items-center justify-center shadow-lg">
						<StreamVideo
							stream={activeScreenStream}
							isLocal={false}
							objectFit="contain"
							className="w-full h-full"
						/>
						{presenterName && (
							<div className="absolute top-3 start-3 px-3 py-1 rounded-md bg-[#111214]/85 backdrop-blur-md text-xs font-semibold text-white border border-white/10 flex items-center gap-2 shadow-md">
								<Monitor size={14} className="text-[#23a55a]" />
								<span>{presenterName}</span>
								<span className="px-1.5 py-0.2 rounded bg-[#da373c] text-[10px] font-bold uppercase tracking-wider text-white">
									LIVE
								</span>
							</div>
						)}
					</div>
				)}

				{/* Discord Participant Cards Grid */}
				<div
					className={
						activeScreenStream
							? 'flex gap-2.5 overflow-x-auto py-1 shrink-0 h-32 scrollbar-thin'
							: `grid gap-3 ${gridCols} auto-rows-fr h-full overflow-y-auto`
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
								className={`group relative flex flex-col items-center justify-center rounded-2xl transition-all duration-150 overflow-hidden bg-[#2b2d31] select-none ${
									activeScreenStream ? 'w-40 h-28 shrink-0' : 'w-full h-full min-h-[140px]'
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
														? 'ring-4 ring-[#23a55a] shadow-[0_0_16px_rgba(35,165,90,0.65)]'
														: ''
												}`}
											>
												<Avatar
													userId={userId}
													avatarId={memberAvatars[userId]}
													size={isExpanded ? 80 : 56}
												/>
											</div>
										</div>
									</div>
								)}

								{/* Discord Bottom-Left Username Tag Pill */}
								<div className="absolute bottom-2.5 start-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111214]/85 backdrop-blur-md text-[12px] font-semibold text-white/95 shadow-md pointer-events-none max-w-[85%] border border-white/5">
									<span className="truncate">
										{memberNames[userId] || (isMe ? currentUser?.username : `User ${userId.slice(0, 6)}`)}
										{isMe && ' (You)'}
									</span>

									{/* Status indicators inside badge */}
									{isMe && isMuted && (
										<div className="text-[#da373c] shrink-0" title="Muted">
											<MicOff size={12} />
										</div>
									)}
									{isMe && isDeafened && (
										<div className="text-[#da373c] shrink-0" title="Deafened">
											<Headphones size={12} />
										</div>
									)}
									{isLocalMuted && (
										<div className="text-[#da373c] shrink-0" title="Muted locally">
											<VolumeX size={12} />
										</div>
									)}
								</div>
							</div>
						);

						if (isMe) {
							return <div key={userId} className="w-full h-full">{tileContent}</div>;
						}

						return (
							<ContextMenu key={userId}>
								<ContextMenuTrigger className="w-full h-full cursor-context-menu">
									{tileContent}
								</ContextMenuTrigger>
								<ContextMenuContent className="w-60 bg-[#111214] border-[#2b2d31] text-white">
									<ContextMenuLabel className="flex items-center gap-2 text-white/90">
										<Settings2 size={14} className="text-[#23a55a]" />
										{memberNames[userId] || `User ${userId.slice(0, 6)}`}
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
				<div className="w-full flex items-center justify-center shrink-0 pt-2 pb-1">
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

						{/* Mic Mute / Unmute Button */}
						<button
							type="button"
							onClick={onMuteToggle}
							className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isMuted
									? 'bg-[#da373c] text-white hover:bg-[#be3135] shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
						>
							{isMuted ? <MicOff size={19} /> : <Mic size={19} />}
						</button>

						{/* Deafen Button */}
						<button
							type="button"
							onClick={onDeafenToggle}
							className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
								isDeafened
									? 'bg-[#da373c] text-white hover:bg-[#be3135] shadow-md'
									: 'bg-[#2b2d31] hover:bg-[#35373c] text-white/90'
							}`}
							title={isDeafened ? 'Undeafen' : 'Deafen'}
						>
							{isDeafened ? <VolumeX size={19} /> : <Headphones size={19} />}
						</button>

						<div className="w-px h-6 bg-white/10 mx-0.5" />

						{/* Disconnect Button (Discord Red) */}
						<button
							type="button"
							onClick={onDisconnect}
							className="w-11 h-11 rounded-full bg-[#da373c] hover:bg-[#be3135] text-white shadow-lg flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
							title="Disconnect"
						>
							<PhoneOff size={19} />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
