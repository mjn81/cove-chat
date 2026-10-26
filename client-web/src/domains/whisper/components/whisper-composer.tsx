import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileText, Loader2, SendHorizontal, Smile, Video, X } from 'lucide-react';

import { AttachMenu } from '@/components/attach-menu';
import EmojiPicker from '@/components/EmojiPicker';
import VoiceRecorder from '@/domains/recording/components/voice-recorder';
import { VideoMessageRecorderModal } from '@/domains/recording/components/video-message-recorder-modal';
import { useFilePicker } from '@/hooks/use-file-picker';
import { useAppStore } from '@/store/store';
import { useWhisperStore } from '@/store/whisperStore';
import { decodeAudioBlob, extractWaveformPeaks } from '@/utils/audio';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

interface WhisperComposerProps {
	channelId: string;
	peerUsername: string;
	/** Whisper video messages are capped lower than normal ones. */
	isMobile: boolean;
	/** The session ended or was burned: nothing can be sent. */
	isClosed: boolean;
	/** False until the key exchange finished. */
	hasSessionKey: boolean;
	/** Files dropped onto the chat area, queued by the parent. */
	queuedFiles: File[];
	onQueueFiles: (files: File[]) => void;
	onRemoveQueued: (index: number) => void;
	onFilesSent: () => void;
}

/** Whisper video messages are limited to 15 MB (everything stays in memory/IndexedDB on both devices). */
const MAX_WHISPER_VIDEO_BYTES = 15 * 1024 * 1024;

const iconButtonClass =
	'group flex cursor-pointer items-center justify-center rounded-full p-1 text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground';

/** Dashed "incognito" composer for Whisper sessions: text, attachments, voice, video, emoji. */
export const WhisperComposer = ({
	channelId,
	peerUsername,
	isMobile,
	isClosed,
	hasSessionKey,
	queuedFiles,
	onQueueFiles,
	onRemoveQueued,
	onFilesSent,
}: WhisperComposerProps) => {
	const { t } = useTranslation();
	const theme = useAppStore((s) => s.theme);
	const { sendMessage, sendFile, sendVoiceMessage, sendVideoMessage } = useWhisperStore();

	const [inputText, setInputText] = useState('');
	const [isSending, setIsSending] = useState(false);
	const [showEmoji, setShowEmoji] = useState(false);
	const [showVideoRecorder, setShowVideoRecorder] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const filePicker = useFilePicker((files) => onQueueFiles(files));
	const disabled = isClosed || !hasSessionKey;
	const iconSize = isMobile ? 18 : 22;
	const canSend = (inputText.trim() !== '' || queuedFiles.length > 0) && !disabled && !isSending;

	const handleSend = async () => {
		const trimmed = inputText.trim();
		if (!canSend) return;

		setIsSending(true);
		try {
			if (queuedFiles.length > 0) {
				for (const file of queuedFiles) await sendFile(file);
				onFilesSent();
			}
			if (trimmed) {
				await sendMessage(trimmed);
				setInputText('');
				if (textareaRef.current) textareaRef.current.style.height = 'auto';
			}
		} finally {
			setIsSending(false);
		}
	};

	const sendVoice = async (voiceFile: File, duration?: number) => {
		if (disabled) return;
		try {
			let waveform: number[] | undefined;
			try {
				waveform = extractWaveformPeaks(await decodeAudioBlob(voiceFile), 32);
			} catch (e) {
				logger.warn('Failed to extract waveform', { error: String(e) });
			}
			await sendVoiceMessage(voiceFile, duration, waveform);
		} catch (err) {
			logger.error('Failed to send whisper voice message', { error: String(err) });
		}
	};

	const sendVideo = async (videoFile: File) => {
		if (disabled) return;
		if (videoFile.size > MAX_WHISPER_VIDEO_BYTES) {
			toast.error(t('errors.video_too_large', { size: 15 }));
			return;
		}
		try {
			await sendVideoMessage(videoFile);
		} catch (err) {
			logger.error('Failed to send whisper video message', { error: String(err) });
		}
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInputText(e.target.value);
		e.target.style.height = 'auto';
		e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="relative z-10 shrink-0 px-4 pb-4 pt-0">
			<div className="relative flex flex-col overflow-hidden rounded-xl border border-dashed border-border/90 bg-secondary/70 text-flat transition-all focus-within:border-foreground/50 focus-within:ring-0">
				{queuedFiles.length > 0 && (
					<div className="flex gap-3 overflow-x-auto border-b border-dashed border-border/80 p-3">
						{queuedFiles.map((f, idx) => (
							<QueuedFilePreview key={idx} file={f} onRemove={() => onRemoveQueued(idx)} />
						))}
					</div>
				)}

				<div className={cn('flex items-start', isMobile ? 'gap-2 px-2 py-2' : 'gap-3 px-4 py-2.5')}>
					<AttachMenu compact={isMobile} disabled={disabled} onPick={filePicker.open} />
					<input {...filePicker.inputProps} />

					<textarea
						ref={textareaRef}
						data-chat-input
						className="max-h-[140px] min-h-[24px] flex-1 resize-none border-none bg-transparent pb-0 pt-[3px] text-[15px] leading-6 text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/60 focus:ring-0"
						placeholder={
							isClosed ? t('whisper.chat.session_ended') : t('composer.message_to', { target: peerUsername })
						}
						aria-label={t('composer.message_to', { target: peerUsername })}
						value={inputText}
						disabled={disabled}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						rows={1}
						dir="auto"
					/>

					<div className={cn('flex shrink-0 items-center', isMobile ? 'gap-1' : 'gap-1.5')}>
						<VoiceRecorder
							channelId={channelId}
							onFile={(file) => onQueueFiles([file])}
							onSendVoice={sendVoice}
							size={iconSize}
						/>
						<button
							type="button"
							disabled={disabled}
							onClick={() => setShowVideoRecorder(true)}
							className={iconButtonClass}
							title={t('composer.record_video')}
							aria-label={t('composer.record_video')}
						>
							<Video
								size={iconSize}
								className="transition-transform group-hover:scale-110 group-disabled:scale-100"
							/>
						</button>
						<button
							type="button"
							disabled={disabled}
							onClick={(e) => {
								e.stopPropagation();
								setShowEmoji((v) => !v);
							}}
							className={iconButtonClass}
							title={t('composer.add_emoji')}
							aria-label={t('composer.add_emoji')}
						>
							<Smile
								size={iconSize}
								className="transition-transform group-hover:scale-110 group-disabled:scale-100"
							/>
						</button>
						<button
							type="button"
							onClick={handleSend}
							disabled={!canSend}
							className={iconButtonClass}
							title={t('whisper.chat.send')}
							aria-label={t('whisper.chat.send')}
						>
							{isSending ? (
								<Loader2 size={iconSize} className="animate-spin text-primary" />
							) : (
								<SendHorizontal
									size={iconSize}
									className="transition-transform group-hover:scale-110 group-disabled:scale-100 rtl:-scale-x-100"
								/>
							)}
						</button>
					</div>
				</div>
			</div>

			{showEmoji && (
				<div className="absolute bottom-[70px] end-6 z-50">
					<EmojiPicker
						onSelect={(emoji) => {
							setInputText((prev) => prev + emoji.native);
							setShowEmoji(false);
						}}
						onClickOutside={() => setShowEmoji(false)}
						theme={theme}
					/>
				</div>
			)}

			<VideoMessageRecorderModal
				open={showVideoRecorder}
				onClose={() => setShowVideoRecorder(false)}
				onSend={sendVideo}
			/>
		</div>
	);
};

/** Thumbnail (images) or icon (other files) for a file waiting to be sent. */
const QueuedFilePreview = ({ file, onRemove }: { file: File; onRemove: () => void }) => {
	const { t } = useTranslation();
	const isImage = file.type.startsWith('image/');
	const [previewUrl] = useState(() => (isImage ? URL.createObjectURL(file) : null));

	return (
		<div className="group relative flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-md bg-accent/30 p-2">
			<button
				type="button"
				onClick={onRemove}
				className="absolute -end-1 -top-1 z-20 cursor-pointer rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
				title={t('whisper.chat.remove_attachment')}
				aria-label={t('whisper.chat.remove_attachment')}
			>
				<X size={14} />
			</button>
			{previewUrl ? (
				<img src={previewUrl} alt={t('composer.preview_alt')} className="h-full w-full rounded object-cover" />
			) : (
				<div className="flex flex-col items-center gap-1">
					<FileText size={28} className="text-muted-foreground" />
					<span className="w-20 truncate text-center text-[10px] text-muted-foreground">{file.name}</span>
				</div>
			)}
		</div>
	);
};
