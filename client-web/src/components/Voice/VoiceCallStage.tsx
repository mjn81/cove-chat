import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Maximize2, MicOff, Monitor, Ratio } from 'lucide-react';
import { useVoiceStore } from '@/store/voiceStore';
import { useAuthStore, getChannelDisplayName } from '@/store/store';
import { webRTCManager } from '@/rtc/WebRTCManager';
import { useElementSize } from '@/hooks/use-element-size';
import type { Channel } from '@/types/api';
import { ScreenContextMenu, StreamVideo, type ScreenShareItem } from './call-media';
import { ParticipantTile, ScreenTile } from './call-tile';
import { CallControls } from './call-controls';
import { chunkRows, fitGrid, pickTileRatio } from './call-layout';

interface VoiceCallStageProps {
	channel: Channel;
}

const GAP = 12;
/** Below this stage width the filmstrip moves from the side to the bottom. */
const SIDE_STRIP_MIN_WIDTH = 720;
const STAGE_HEIGHT_KEY = 'cove_call_stage_height';

/**
 * Call stage embedded in the chat layout. Participants are fixed 16:9 tiles sized by `fitGrid` (never stretched);
 * when someone shares a screen it takes the main stage and everyone else moves to a filmstrip, Meet / Discord style.
 * Controls live in a single dock under the tiles.
 */
export const VoiceCallStage: React.FC<VoiceCallStageProps> = ({ channel }) => {
	const { t } = useTranslation();
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [objectFit, setObjectFit] = useState<'contain' | 'cover'>('contain');
	const [stageHeight, setStageHeight] = useState<number>(() => {
		try {
			const parsed = parseInt(localStorage.getItem(STAGE_HEIGHT_KEY) ?? '', 10);
			if (!isNaN(parsed) && parsed >= 280) return parsed;
		} catch {
			/* ignore */
		}
		return 420;
	});

	const stageContainerRef = useRef<HTMLDivElement | null>(null);
	const [areaRef, area] = useElementSize<HTMLDivElement>();

	const currentUser = useAuthStore((s) => s.user);
	const currentUserId = currentUser?.id;
	const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
	const localScreenStream = useVoiceStore((s) => s.localScreenStream);
	const remoteScreenStreams = useVoiceStore((s) => s.remoteScreenStreams);
	const participantTrackStates = useVoiceStore((s) => s.participantTrackStates);
	const spotlightStreamId = useVoiceStore((s) => s.spotlightStreamId);
	const setSpotlightStreamId = useVoiceStore((s) => s.setSpotlightStreamId);
	const rawParticipants = useVoiceStore((s) => s.participants[channel.id]);
	const isConnecting = useVoiceStore((s) => s.callStatus === 'connecting');

	// The current user is always on the roster, even before the server echoes them back.
	const members = useMemo(() => {
		const set = new Set(rawParticipants ?? []);
		if (currentUserId) set.add(currentUserId);
		return Array.from(set);
	}, [rawParticipants, currentUserId]);

	const allScreenShares = useMemo<ScreenShareItem[]>(() => {
		const list: ScreenShareItem[] = [];
		if (isScreenSharing && localScreenStream && localScreenStream.getVideoTracks().length > 0) {
			list.push({
				id: 'local',
				userId: currentUserId || 'local',
				username: t('call.screenOf', { name: currentUser?.username || t('call.you') }),
				stream: localScreenStream,
				isLocal: true,
			});
		}
		for (const [uid, stream] of Object.entries(remoteScreenStreams)) {
			if (stream && stream.getVideoTracks().length > 0) {
				list.push({
					id: uid,
					userId: uid,
					username: t('call.screenOf', { name: channel.member_names?.[uid] || `User ${uid.slice(0, 6)}` }),
					stream,
					isLocal: false,
				});
			}
		}
		return list;
	}, [isScreenSharing, localScreenStream, remoteScreenStreams, currentUserId, currentUser?.username, channel.member_names, t]);

	const activeSpotlight = useMemo<ScreenShareItem | null>(() => {
		if (allScreenShares.length === 0) return null;
		return allScreenShares.find((item) => item.id === spotlightStreamId) ?? allScreenShares[0];
	}, [allScreenShares, spotlightStreamId]);

	// Remote screens need a keyframe as soon as they appear or decoding stalls on a black frame.
	useEffect(() => {
		for (const share of allScreenShares) {
			if (!share.isLocal) webRTCManager.requestKeyframe(share.userId);
		}
	}, [allScreenShares]);

	// Keep our fullscreen flag truthful when the browser leaves fullscreen itself (Esc key).
	useEffect(() => {
		const sync = () => setIsFullscreen(document.fullscreenElement === stageContainerRef.current);
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	}, []);

	const toggleFullscreen = () => {
		const el = stageContainerRef.current;
		if (!el) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void el.requestFullscreen().catch(() => {
				/* denied (e.g. embedded webview): stay windowed */
			});
		}
	};

	const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		const startY = e.clientY;
		const startH = stageHeight;
		const clamp = (h: number) => Math.max(280, Math.min(window.innerHeight - 150, h));
		const onMove = (ev: PointerEvent) => setStageHeight(clamp(startH + ev.clientY - startY));
		const onUp = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			try {
				localStorage.setItem(STAGE_HEIGHT_KEY, String(clamp(startH + ev.clientY - startY)));
			} catch {
				/* ignore */
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	};

	const renderParticipant = (userId: string, width: number, height: number) => {
		const userScreen = allScreenShares.find((s) => (userId === currentUserId ? s.id === 'local' : s.userId === userId));
		return (
			<ParticipantTile
				key={userId}
				userId={userId}
				channel={channel}
				width={width}
				height={height}
				onClick={userScreen ? () => setSpotlightStreamId(userScreen.id) : undefined}
			/>
		);
	};

	if (isCollapsed && !isFullscreen) {
		return (
			<div className="flex h-10 shrink-0 select-none items-center justify-between border-b border-border bg-popover px-4 text-foreground">
				<div className="flex min-w-0 items-center gap-2">
					<span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-success" />
					<span className="truncate text-xs font-semibold">{getChannelDisplayName(channel, currentUserId ?? '')}</span>
					<span className="hidden text-[11px] text-muted-foreground tabular-nums sm:inline">{members.length}</span>
				</div>
				<button
					type="button"
					onClick={() => setIsCollapsed(false)}
					className="flex cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
				>
					<ChevronDown size={14} />
					<span>{t('call.showCall')}</span>
				</button>
			</div>
		);
	}

	// Side filmstrip on wide stages, bottom strip on narrow ones.
	const sideStrip = area.width >= SIDE_STRIP_MIN_WIDTH;
	const stripTileW = sideStrip ? 200 : 128;
	const stripTileH = Math.round((stripTileW * 9) / 16);
	const otherScreens = allScreenShares.filter((s) => s.id !== activeSpotlight?.id);
	const grid = fitGrid(members.length, area.width, area.height, GAP, pickTileRatio(area.width, area.height));

	return (
		<div
			ref={stageContainerRef}
			style={!isFullscreen ? { height: `${stageHeight}px` } : undefined}
			className={
				isFullscreen
					? 'fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-50 flex flex-col overflow-hidden bg-popover'
					: 'relative flex w-full shrink-0 select-none flex-col overflow-hidden border-b border-border bg-popover'
			}
		>
			<div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden px-4 pt-4 pb-2">
				{isConnecting && (
					<div className="absolute start-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
						{t('call.connecting')}
					</div>
				)}
				{activeSpotlight ? (
					<div className={`flex h-full w-full gap-3 ${sideStrip ? 'flex-row' : 'flex-col'}`}>
						<div className="group relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-black">
							<ScreenContextMenu
								screen={activeSpotlight}
								isSpotlight
								objectFit={objectFit}
								onToggleFit={() => setObjectFit(objectFit === 'contain' ? 'cover' : 'contain')}
								onSelectSpotlight={() => {}}
							>
								<div className="flex h-full w-full items-center justify-center">
									<StreamVideo stream={activeSpotlight.stream} objectFit={objectFit} className="h-full w-full" />
								</div>
							</ScreenContextMenu>
							<div className="pointer-events-none absolute start-3 top-3 flex items-center gap-2 rounded-md bg-popover/80 px-2.5 py-1 text-xs font-medium text-foreground">
								<Monitor size={13} className="text-primary" />
								<span className="truncate">{activeSpotlight.username}</span>
								{!activeSpotlight.isLocal && participantTrackStates[activeSpotlight.userId]?.audio === false && (
									<MicOff size={12} className="text-destructive" />
								)}
							</div>
							<div className="absolute end-3 top-3 flex items-center gap-1 rounded-md bg-popover/80 p-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
								<button
									type="button"
									onClick={() => setObjectFit(objectFit === 'contain' ? 'cover' : 'contain')}
									className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
									title={objectFit === 'contain' ? t('call.fill') : t('call.fit')}
								>
									<Ratio size={12} />
									<span>{objectFit === 'contain' ? t('call.fit') : t('call.fill')}</span>
								</button>
								<button
									type="button"
									onClick={toggleFullscreen}
									className="cursor-pointer rounded p-1 text-foreground transition-colors hover:bg-accent"
									title={t('call.fullscreen')}
								>
									<Maximize2 size={13} />
								</button>
							</div>
						</div>

						<div
							className={`flex shrink-0 gap-2 overflow-auto ${
								sideStrip ? 'w-[200px] flex-col' : 'h-[72px] w-full flex-row justify-center'
							}`}
						>
							{members.map((id) => renderParticipant(id, stripTileW, stripTileH))}
							{otherScreens.map((s) => (
								<ScreenTile
									key={`screen-${s.id}`}
									name={s.username}
									stream={s.stream}
									width={stripTileW}
									height={stripTileH}
									onClick={() => setSpotlightStreamId(s.id)}
								/>
							))}
						</div>
					</div>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						{grid.cols > 0 && (
							<div className="flex flex-col items-center" style={{ gap: GAP }}>
								{chunkRows(members, grid.cols).map((row) => (
									<div key={row[0]} className="flex justify-center" style={{ gap: GAP }}>
										{row.map((id) => renderParticipant(id, grid.width, grid.height))}
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="shrink-0 px-3 pb-3 pt-1">
				<CallControls
					isFullscreen={isFullscreen}
					onToggleFullscreen={toggleFullscreen}
					onMinimize={() => setIsCollapsed(true)}
				/>
			</div>

			{!isFullscreen && (
				<div
					onPointerDown={handleResizeStart}
					className="group flex h-2 w-full shrink-0 cursor-row-resize items-center justify-center transition-colors hover:bg-primary/20"
				>
					<div className="h-1 w-12 rounded-full bg-border transition-colors group-hover:bg-primary" />
				</div>
			)}
		</div>
	);
};
