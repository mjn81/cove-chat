import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import { useVoiceStore } from '@/store/voiceStore';
import { useAuthStore, getChannelDisplayName } from '@/store/store';
import { useElementSize } from '@/hooks/use-element-size';
import type { Channel } from '@/types/api';
import { StreamVideo } from './call-media';
import { ParticipantTile } from './call-tile';
import { CallControls } from './call-controls';
import { chunkRows, fitGrid, pickTileRatio } from './call-layout';

interface VoiceChatPanelProps {
	/** The channel the call belongs to. */
	channel: Channel;
	/** User IDs currently in the call, including the current user. */
	members: string[];
	/** Takes the user back to the call's own chat, where the full call stage lives. */
	onReturnToChat: () => void;
}

const GAP = 8;
const STRIP_TILE_W = 112;
const STRIP_TILE_H = 63;

/**
 * Floating call panel shown while the user browses a different chat than the one their call is in. It reuses the
 * stage's tiles, fitted grid and control dock; its fullscreen button returns to the source chat rather than
 * enlarging the panel, so there is one place to see a call full size.
 */
export const VoiceChatPanel: React.FC<VoiceChatPanelProps> = ({ channel, members, onReturnToChat }) => {
	const { t } = useTranslation();
	const [areaRef, area] = useElementSize<HTMLDivElement>();
	const currentUserId = useAuthStore((s) => s.user?.id);
	const remoteStreams = useVoiceStore((s) => s.remoteStreams);
	const remoteScreenStreams = useVoiceStore((s) => s.remoteScreenStreams);
	const localScreenStream = useVoiceStore((s) => s.localScreenStream);
	const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
	const spotlightStreamId = useVoiceStore((s) => s.spotlightStreamId);

	const screen = useMemo(() => {
		const local = isScreenSharing && localScreenStream?.getVideoTracks().length ? localScreenStream : null;
		const remote = Object.entries(remoteScreenStreams).filter(([, st]) => st && st.getVideoTracks().length > 0);
		if (spotlightStreamId === 'local' && local) return local;
		return remote.find(([uid]) => uid === spotlightStreamId)?.[1] ?? local ?? remote[0]?.[1] ?? null;
	}, [isScreenSharing, localScreenStream, remoteScreenStreams, spotlightStreamId]);

	const grid = fitGrid(members.length, area.width, area.height, GAP, pickTileRatio(area.width, area.height));

	return (
		<div className="fixed inset-x-0 bottom-0 z-50 flex h-[min(520px,80dvh)] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-popover sm:inset-x-auto sm:bottom-6 sm:end-6 sm:w-[420px] sm:rounded-2xl">
			{/* Remote audio elements stay mounted so playback survives the call stage unmounting. */}
			{members
				.filter((uid) => uid !== currentUserId)
				.map((uid) => (
					<audio
						key={uid}
						ref={(el) => {
							const stream = remoteStreams[uid];
							if (el && stream && el.srcObject !== stream) {
								el.srcObject = stream;
								el.play().catch(() => {});
							}
						}}
						autoPlay
						playsInline
						className="hidden"
					/>
				))}

			<div className="flex shrink-0 select-none items-center gap-2 border-b border-border px-4 py-2.5">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-foreground">
						{getChannelDisplayName(channel, currentUserId ?? '')}
					</div>
					<div className="text-xs text-muted-foreground">{t('call.inCall', { count: members.length })}</div>
				</div>
			</div>

			<div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden p-3">
				{screen ? (
					<div className="flex h-full w-full flex-col gap-2">
						<div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
							<StreamVideo stream={screen} objectFit="contain" className="h-full w-full" />
							<div className="pointer-events-none absolute start-2 top-2 flex items-center gap-1.5 rounded-md bg-popover/80 px-2 py-0.5 text-xs font-medium text-foreground">
								<Monitor size={12} className="text-primary" />
								<span>{t('call.live')}</span>
							</div>
						</div>
						<div className="flex shrink-0 justify-center gap-2 overflow-x-auto">
							{members.map((id) => (
								<ParticipantTile key={id} userId={id} channel={channel} width={STRIP_TILE_W} height={STRIP_TILE_H} />
							))}
						</div>
					</div>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						{grid.cols > 0 && (
							<div className="flex flex-col items-center" style={{ gap: GAP }}>
								{chunkRows(members, grid.cols).map((row) => (
									<div key={row[0]} className="flex justify-center" style={{ gap: GAP }}>
										{row.map((id) => (
											<ParticipantTile key={id} userId={id} channel={channel} width={grid.width} height={grid.height} />
										))}
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="shrink-0 px-3 pb-3 pt-1">
				<CallControls isFullscreen={false} onToggleFullscreen={onReturnToChat} fullscreenLabel={t('call.backToChat')} />
			</div>
		</div>
	);
};
