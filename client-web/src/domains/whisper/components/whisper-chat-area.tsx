import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2 } from 'lucide-react';

import { ChatBackgroundPattern } from '@/components/Chat/ChatBackgroundPattern';
import { useFeedScroll } from '@/hooks/use-feed-scroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAuthStore, useChannelStore, getChannelDisplayName } from '@/store/store';
import { useWhisperStore } from '@/store/whisperStore';
import { formatCountdown, formatDayLabel } from '@/utils/datetime';
import { cn } from '@/lib/utils';
import type { Channel } from '@/types/api';
import { isSameSenderBurst } from '../utils/message-grouping';
import { WhisperComposer } from './whisper-composer';
import { DateDivider, WhisperIntro, WhisperMessageRow, WhisperStatusBanner } from './whisper-feed-parts';
import { WhisperTopbar } from './whisper-topbar';

interface WhisperChatAreaProps {
	channel: Channel;
}

/** How often disappearing-message countdowns are refreshed. */
const COUNTDOWN_TICK_MS = 3000;

/**
 * The Whisper (zero-persistence E2EE) conversation view: topbar, message
 * feed with countdowns, and the dashed composer. Files can also be dropped
 * anywhere on the view.
 */
export const WhisperChatArea: React.FC<WhisperChatAreaProps> = ({ channel }) => {
	const { t } = useTranslation();
	const { activeSession, burnSession, exitWhisperMode, openSafetyNumberModal, isConnecting } =
		useWhisperStore();
	const currentUser = useAuthStore((state) => state.user);
	const isMobile = useMediaQuery('(max-width: 768px)');
	const liveChannel =
		useChannelStore((state) => state.channels.find((c) => c.id === channel.id)) || channel;

	const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const messages = activeSession?.messages ?? [];
	const { feedRef, endRef, isAtBottom, onScroll, scrollToBottom } = useFeedScroll(messages.length);

	// Countdown labels are derived from `now`, so ticking it re-renders them.
	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
		return () => clearInterval(interval);
	}, []);

	const queueFiles = useCallback((files: File[]) => setQueuedFiles((prev) => [...prev, ...files]), []);

	if (!activeSession) {
		return (
			<div className="whisper-mode flex h-full w-full flex-col items-center justify-center bg-background p-4 text-muted-foreground">
				<Loader2 className="mb-2 h-8 w-8 animate-spin text-primary" />
				<p className="text-sm">{t('whisper.chat.initializing')}</p>
			</div>
		);
	}

	const isClosed = activeSession.status === 'closed' || activeSession.status === 'burned';
	const otherMemberId =
		liveChannel.members.find((m) => m !== currentUser?.id) || liveChannel.members[0] || liveChannel.id;
	const otherStatus = liveChannel.member_statuses?.[otherMemberId] || 'offline';
	const dayLabels = { today: t('chat.today'), yesterday: t('chat.yesterday') };

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const files = e.dataTransfer.files;
		if (!files || files.length === 0 || !activeSession.sessionKey || isClosed) return;
		queueFiles(Array.from(files));
	};

	return (
		<div
			onDragOver={(e) => {
				e.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={() => setIsDragging(false)}
			onDrop={handleDrop}
			className={cn(
				'whisper-mode relative flex h-full w-full select-text flex-col overflow-hidden overscroll-none bg-background',
				isDragging && 'ring-2 ring-inset ring-primary',
			)}
		>
			<ChatBackgroundPattern />

			<WhisperTopbar
				peerId={otherMemberId}
				peerAvatarId={liveChannel.member_avatars?.[otherMemberId]}
				displayName={getChannelDisplayName(liveChannel, currentUser?.id || '')}
				status={otherStatus}
				canVerify={Boolean(activeSession.sessionKey)}
				verified={activeSession.verified}
				showBack={isMobile}
				onVerify={openSafetyNumberModal}
				onBurn={() => burnSession()}
				onExit={exitWhisperMode}
			/>

			<div className="relative z-10 min-h-0 flex-1">
				<div
					ref={feedRef}
					onScroll={onScroll}
					className="absolute inset-0 overflow-y-auto overflow-x-hidden px-4 py-6"
					style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }}
				>
					<WhisperIntro
						peerId={otherMemberId}
						peerAvatarId={liveChannel.member_avatars?.[otherMemberId]}
						peerUsername={activeSession.peerUsername}
						expiryMode={activeSession.expiryMode}
					/>

					{activeSession.statusMessage && (
						<WhisperStatusBanner message={activeSession.statusMessage} busy={isConnecting} />
					)}

					{messages.map((msg, i) => {
						const prev = messages[i - 1];
						const dayLabel = formatDayLabel(msg.sentAt, dayLabels);
						const isMe = msg.senderId === currentUser?.id;
						const senderName = isMe
							? currentUser?.username || t('whisper.chat.you')
							: liveChannel.member_names?.[msg.senderId] ||
								activeSession.peerUsername ||
								t('whisper.chat.user');

						return (
							<React.Fragment key={msg.id}>
								{(!prev || dayLabel !== formatDayLabel(prev.sentAt, dayLabels)) && (
									<DateDivider label={dayLabel} />
								)}
								<WhisperMessageRow
									message={msg}
									senderName={senderName}
									senderAvatarId={liveChannel.member_avatars?.[msg.senderId]}
									grouped={isSameSenderBurst(prev, msg)}
									isMobile={isMobile}
									expiryLabel={formatCountdown(msg.expiresAt, now, t('whisper.chat.expired'))}
								/>
							</React.Fragment>
						);
					})}
					<div ref={endRef} />
				</div>

				<button
					type="button"
					onClick={scrollToBottom}
					aria-label={t('whisper.chat.scroll_latest')}
					className={cn(
						'absolute bottom-4 end-4 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border bg-secondary text-foreground transition-all duration-200 hover:bg-accent',
						isAtBottom ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100',
					)}
				>
					<ChevronDown size={18} />
				</button>
			</div>

			<WhisperComposer
				channelId={channel.id}
				peerUsername={activeSession.peerUsername}
				isMobile={isMobile}
				isClosed={isClosed}
				hasSessionKey={Boolean(activeSession.sessionKey)}
				queuedFiles={queuedFiles}
				onQueueFiles={queueFiles}
				onRemoveQueued={(index) => setQueuedFiles((prev) => prev.filter((_, i) => i !== index))}
				onFilesSent={() => setQueuedFiles([])}
			/>
		</div>
	);
};

WhisperChatArea.displayName = 'WhisperChatArea';
