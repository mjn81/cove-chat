import { useTranslation } from 'react-i18next';
import { AlertCircle, Clock, Download, FileText, Loader2, Lock } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { WhisperVoiceBubble } from '@/components/Chat/File/WhisperVoiceBubble';
import { WhisperVideoBubble } from '@/components/Chat/File/WhisperVideoBubble';
import { cn } from '@/lib/utils';
import { formatClockTime } from '@/utils/datetime';
import { formatFileSize } from '@/utils/file';
import type { WhisperMessageFile, WhisperMessageItem } from '@/store/whisperStore';
import type { WhisperExpiryMode } from '@/lib/whisperDb';

/** Opening card of a Whisper session: who it is with, and how messages are kept. */
export const WhisperIntro = ({
	peerId,
	peerAvatarId,
	peerUsername,
	expiryMode,
}: {
	peerId: string;
	peerAvatarId?: string;
	peerUsername: string;
	expiryMode: WhisperExpiryMode;
}) => {
	const { t } = useTranslation();
	return (
		<div className="mb-6 border-b border-border/50 px-2 py-10">
			<div className="relative mb-3 inline-block">
				<Avatar userId={peerId} avatarId={peerAvatarId} size={72} />
				<div className="absolute -bottom-1 -end-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
					<Lock size={12} />
				</div>
			</div>
			<h1 className="mb-1.5 text-2xl font-bold text-foreground">{peerUsername}</h1>
			<p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
				{t('whisper.chat.intro', { name: peerUsername })}
			</p>
			<p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground/80">
				{t('whisper.chat.zero_storage')} {t(`whisper.chat.expiry_${expiryMode}`)}
			</p>
		</div>
	);
};

/** Centered status line (connecting, peer left, ...). */
export const WhisperStatusBanner = ({ message, busy }: { message: string; busy: boolean }) => (
	<div className="mx-auto my-4 flex max-w-md items-center justify-center gap-2 rounded-lg border border-border bg-secondary/80 px-3.5 py-2 text-center text-xs text-muted-foreground">
		{busy ? (
			<Loader2 size={14} className="shrink-0 animate-spin text-primary" />
		) : (
			<AlertCircle size={14} className="shrink-0" />
		)}
		<span>{message}</span>
	</div>
);

/** Day divider between messages from different days. */
export const DateDivider = ({ label }: { label: string }) => (
	<div className="relative my-6 flex select-none items-center justify-center">
		<div className="absolute inset-0 flex items-center">
			<div className="w-full border-t border-border/50" />
		</div>
		<div className="relative flex items-center justify-center rounded-full border border-border/50 bg-background px-3 py-0.5 text-xs font-semibold text-muted-foreground">
			{label}
		</div>
	</div>
);

/** The attachment of a Whisper message: voice/video bubbles, an inline image, or a file card with download. */
const WhisperAttachment = ({ file }: { file: WhisperMessageFile }) => {
	const { t } = useTranslation();

	if (file.type === 'voice' || (!file.type && file.mime.startsWith('audio/'))) {
		return <WhisperVoiceBubble file={file} />;
	}
	if (file.type === 'video') return <WhisperVideoBubble file={file} />;

	if (file.mime.startsWith('image/') && file.blobUrl) {
		return (
			<div className="inline-block max-h-72 max-w-sm overflow-hidden rounded-lg border border-border/40">
				<img
					src={file.blobUrl}
					alt={file.name}
					className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-95"
					onClick={() => window.open(file.blobUrl, '_blank')}
				/>
			</div>
		);
	}

	return (
		<div className="flex max-w-sm items-center gap-3 rounded-lg border border-border/50 bg-secondary/60 p-2.5">
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
				<FileText size={18} />
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-semibold text-foreground">{file.name}</p>
				<p className="text-[10px] text-muted-foreground">{formatFileSize(file.size)}</p>
			</div>
			{file.blobUrl && (
				<a
					href={file.blobUrl}
					download={file.name}
					className="shrink-0 cursor-pointer p-1.5 text-primary transition-colors hover:text-foreground"
					title={t('whisper.chat.download')}
				>
					<Download size={16} />
				</a>
			)}
		</div>
	);
};

interface WhisperMessageRowProps {
	message: WhisperMessageItem;
	senderName: string;
	senderAvatarId?: string;
	/** Same sender as the previous message within 5 minutes: show only a time gutter. */
	grouped: boolean;
	isMobile: boolean;
	/** Countdown text for disappearing messages, if any. */
	expiryLabel: string | null;
}

/** One Whisper message: avatar/time gutter, sender header, text and attachment. */
export const WhisperMessageRow = ({
	message,
	senderName,
	senderAvatarId,
	grouped,
	isMobile,
	expiryLabel,
}: WhisperMessageRowProps) => {
	const { t } = useTranslation();

	return (
		<div
			className={cn(
				'group relative -mx-4 mb-0.5 flex cursor-default select-none px-4 py-0.5 transition-colors hover:bg-accent/30',
				!grouped && (isMobile ? 'mt-2' : 'mt-4'),
			)}
		>
			<div className={cn('flex shrink-0 pt-1', isMobile ? 'w-[40px]' : 'w-[55px]')}>
				{!grouped ? (
					<Avatar userId={message.senderId} avatarId={senderAvatarId} size={isMobile ? 32 : 40} />
				) : (
					<div
						className={cn(
							'w-full shrink-0 select-none text-center text-transparent group-hover:text-muted-foreground',
							isMobile ? 'whitespace-nowrap text-[9px]' : 'pt-1 text-[10px]',
						)}
					>
						{formatClockTime(message.sentAt)}
					</div>
				)}
			</div>

			<div className="relative flex min-w-0 flex-1 flex-col">
				{!grouped && (
					<div className={cn('flex flex-nowrap gap-2', isMobile ? 'mb-1 items-center' : 'mb-0.5 items-baseline')}>
						<span
							className={cn(
								'cursor-pointer truncate font-semibold tracking-wide text-foreground hover:underline',
								isMobile ? 'text-sm font-medium' : 'text-[15px]',
							)}
						>
							{senderName}
						</span>
						<span
							className={cn(
								'flex shrink-0 items-center gap-1.5 text-muted-foreground',
								isMobile ? 'whitespace-nowrap text-[9px]' : 'text-xs',
							)}
						>
							<span>{formatClockTime(message.sentAt)}</span>
							{expiryLabel && (
								<span
									className="flex items-center gap-0.5 text-[11px] text-primary/90"
									title={t('whisper.chat.countdown_title')}
								>
									<Clock size={11} />
									<span>{expiryLabel}</span>
								</span>
							)}
						</span>
					</div>
				)}

				{message.text && (
					<div
						className="min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-[15px] leading-[22px] text-foreground/90"
						dir="auto"
					>
						{message.text}
					</div>
				)}

				{message.file && (
					<div className="mt-1">
						<WhisperAttachment file={message.file} />
					</div>
				)}
			</div>
		</div>
	);
};
