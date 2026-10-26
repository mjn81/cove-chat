import React from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones, MicOff, Monitor, Settings2, Volume2, VolumeX } from 'lucide-react';
import { Avatar } from '../Avatar';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '../ui/context-menu';
import { Slider } from '../ui/slider';
import { StreamVideo } from './call-media';
import { webRTCManager } from '@/rtc/WebRTCManager';

interface CallTileProps {
	userId: string;
	name: string;
	avatarId?: string;
	isMe: boolean;
	isSpeaking: boolean;
	isMuted: boolean;
	isDeafened: boolean;
	/** Muted just for this viewer (context menu), not by the participant. */
	isLocallyMuted: boolean;
	volume: number;
	/** Camera stream when the participant's camera is on. */
	cameraStream: MediaStream | null;
	/** Fixed tile size from `fitGrid`; the tile never stretches beyond it. */
	width: number;
	height: number;
	onClick?: () => void;
}

/**
 * One participant in the call: a fixed-ratio tile showing the camera, or a centred avatar, with the name and
 * mute state underneath in a small chip. Remote tiles get a right-click menu for per-user volume.
 */
export const CallTile: React.FC<CallTileProps> = ({
	userId,
	name,
	avatarId,
	isMe,
	isSpeaking,
	isMuted,
	isDeafened,
	isLocallyMuted,
	volume,
	cameraStream,
	width,
	height,
	onClick,
}) => {
	const { t } = useTranslation();
	const hasVideo = !!cameraStream && cameraStream.getVideoTracks().length > 0;
	const avatarSize = Math.max(32, Math.min(112, Math.round(height * 0.38)));

	const tile = (
		<div
			onClick={onClick}
			style={{ width, height }}
			className={`relative shrink-0 overflow-hidden rounded-xl bg-card select-none ${onClick ? 'cursor-pointer' : ''}`}
		>
			{/* Drawn inside the tile (above video) so the whole edge shows and no parent can clip it. */}
			<div
				aria-hidden="true"
				className={`pointer-events-none absolute inset-0 z-20 rounded-xl border-2 transition-colors duration-150 ${
					isSpeaking ? 'border-success' : 'border-transparent'
				}`}
			/>
			{hasVideo ? (
				<StreamVideo stream={cameraStream} mirror={isMe} className="w-full h-full object-cover" />
			) : (
				<div className="absolute inset-0 flex items-center justify-center">
					<Avatar userId={userId} avatarId={avatarId} size={avatarSize} />
				</div>
			)}

			<div className="absolute bottom-2 start-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-popover/80 px-2 py-0.5 text-xs font-medium text-foreground">
				<span className="truncate">
					{name}
					{isMe && ` (${t('call.you')})`}
				</span>
				{isMuted && <MicOff size={12} className="shrink-0 text-destructive" />}
				{isMe && isDeafened && <Headphones size={12} className="shrink-0 text-destructive" />}
				{isLocallyMuted && <VolumeX size={12} className="shrink-0 text-destructive" />}
			</div>
		</div>
	);

	if (isMe) return tile;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild className="cursor-context-menu">
				{tile}
			</ContextMenuTrigger>
			<ContextMenuContent className="w-60 bg-popover border-border text-foreground">
				<ContextMenuLabel className="flex items-center gap-2 text-foreground">
					<Settings2 size={14} className="text-primary" />
					<span className="truncate">{name}</span>
				</ContextMenuLabel>
				<ContextMenuSeparator className="bg-border" />
				<div className="px-3 py-2.5">
					<div className="mb-2 flex items-center justify-between">
						<span className="text-xs font-medium text-foreground">{t('call.volume')}</span>
						<span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
							{Math.round(volume * 100)}%
						</span>
					</div>
					<Slider
						value={[volume * 100]}
						min={0}
						max={200}
						step={1}
						onValueChange={(vals) => webRTCManager.setParticipantVolume(userId, vals[0] / 100)}
					/>
				</div>
				<ContextMenuSeparator className="bg-border" />
				<ContextMenuItem
					onClick={() => webRTCManager.toggleParticipantMute(userId)}
					className={`cursor-pointer ${isLocallyMuted ? 'text-foreground' : 'text-destructive'}`}
				>
					{isLocallyMuted ? <Volume2 className="me-2 h-4 w-4" /> : <VolumeX className="me-2 h-4 w-4" />}
					{isLocallyMuted ? t('call.unmuteForMe') : t('call.muteForMe')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};

interface ScreenTileProps {
	name: string;
	stream: MediaStream;
	width: number;
	height: number;
	onClick: () => void;
}

/** Thumbnail of a shared screen that is not currently spotlighted; clicking it brings it to the main stage. */
export const ScreenTile: React.FC<ScreenTileProps> = ({ name, stream, width, height, onClick }) => (
	<div
		onClick={onClick}
		style={{ width, height }}
		className="relative shrink-0 cursor-pointer overflow-hidden rounded-xl bg-black ring-2 ring-transparent hover:ring-primary/60 transition-shadow"
	>
		<StreamVideo stream={stream} objectFit="contain" className="w-full h-full" />
		<div className="absolute bottom-2 start-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-popover/80 px-2 py-0.5 text-xs font-medium text-foreground">
			<Monitor size={12} className="shrink-0 text-primary" />
			<span className="truncate">{name}</span>
		</div>
	</div>
);
