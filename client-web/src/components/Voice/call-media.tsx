import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Monitor, Ratio, Volume2, VolumeX } from 'lucide-react';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '../ui/context-menu';
import { Slider } from '../ui/slider';
import { useVoiceStore } from '@/store/voiceStore';
import { webRTCManager } from '@/rtc/WebRTCManager';

/** A shared screen (local preview or a remote presenter) that can be spotlighted in the call stage. */
export interface ScreenShareItem {
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
export const StreamVideo: React.FC<{
	stream: MediaStream;
	className?: string;
	objectFit?: 'cover' | 'contain';
	mirror?: boolean;
	onContextMenu?: React.MouseEventHandler;
}> = ({ stream, className, objectFit = 'cover', mirror = false, onContextMenu }) => {
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
export const ScreenContextMenu: React.FC<{
	screen: ScreenShareItem;
	isSpotlight: boolean;
	objectFit: 'contain' | 'cover';
	onToggleFit?: () => void;
	onSelectSpotlight: () => void;
	children: React.ReactNode;
}> = ({ screen, isSpotlight, objectFit, onToggleFit, onSelectSpotlight, children }) => {
	const { t } = useTranslation();
	const screenShareVolumes = useVoiceStore((state) => state.screenShareVolumes);
	const screenShareMutes = useVoiceStore((state) => state.screenShareMutes);

	const volume = screenShareVolumes[screen.userId] ?? 1;
	const isMuted = !!screenShareMutes[screen.userId];

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild className="cursor-context-menu">
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent className="w-64 bg-popover border-border text-foreground shadow-2xl p-1.5 rounded-xl">
				<ContextMenuLabel className="flex items-center gap-2 text-foreground text-xs font-semibold px-2 py-1.5">
					<Monitor size={14} className="text-success" />
					<span className="truncate">{screen.username}</span>
					<span className="ms-auto px-1.5 py-0.5 rounded bg-destructive text-[9px] font-bold text-destructive-foreground uppercase tracking-wider">
						{t('call.live')}
					</span>
				</ContextMenuLabel>
				<ContextMenuSeparator className="bg-border" />

				{!screen.isLocal && (
					<>
						<div className="px-2.5 py-2">
							<div className="flex items-center justify-between mb-2">
								<span className="text-[11px] font-medium text-foreground">{t('call.volume')}</span>
								<span className="text-[11px] font-bold text-success tabular-nums">
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
								isMuted ? 'text-success hover:bg-success/15' : 'text-destructive hover:bg-destructive/15'
							}`}
						>
							{isMuted ? (
								<>
									<Volume2 className="me-2 h-3.5 w-3.5" />
									{t('call.unmute')}
								</>
							) : (
								<>
									<VolumeX className="me-2 h-3.5 w-3.5" />
									{t('call.mute')}
								</>
							)}
						</ContextMenuItem>
						<ContextMenuSeparator className="bg-border" />
					</>
				)}

				{!isSpotlight && (
					<ContextMenuItem
						onClick={onSelectSpotlight}
						className="cursor-pointer px-2 py-1.5 rounded-md text-xs text-foreground hover:bg-card"
					>
						<Maximize2 className="me-2 h-3.5 w-3.5 text-success" />
						{t('call.fullscreen')}
					</ContextMenuItem>
				)}

				{onToggleFit && (
					<ContextMenuItem
						onClick={onToggleFit}
						className="cursor-pointer px-2 py-1.5 rounded-md text-xs text-foreground hover:bg-card"
					>
						<Ratio className="me-2 h-3.5 w-3.5 text-muted-foreground" />
						{objectFit === 'contain' ? t('call.fill') : t('call.fit')}
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
};

