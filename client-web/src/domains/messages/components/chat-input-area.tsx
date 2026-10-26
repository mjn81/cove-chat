import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, SendHorizontal, Smile, Video } from 'lucide-react';

import EmojiPicker from '@/components/EmojiPicker';
import VoiceRecorder from '@/domains/recording/components/voice-recorder';
import { VideoMessageRecorderModal } from '@/domains/recording/components/video-message-recorder-modal';
import { useAppStore, useAuthStore, getChannelDisplayName } from '@/store/store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isDirectMessage } from '@/utils/channel';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import type { Channel, Message } from '@/types/api';
import { useAttachments } from '../hooks/use-attachments';
import { useFileDrop } from '../hooks/use-file-drop';
import { useMentions } from '../hooks/use-mentions';
import { useSendMedia } from '../hooks/use-send-media';
import { useSendText } from '../hooks/use-send-text';
import { AttachMenu } from '@/components/attach-menu';
import { useFilePicker } from '@/hooks/use-file-picker';
import { AttachmentPreviews } from './attachment-previews';
import { DropOverlay, ReplyPreview, SendErrorBanner } from './composer-banners';
import { MentionPopup } from './mention-popup';

interface ChatInputAreaProps {
	channel: Channel;
	channelKey: Uint8Array;
	replyTo?: (Message & { text?: string }) | null;
	onCancelReply?: () => void;
	messages: (Message & { text?: string })[];
}

/** Largest height the textarea grows to before it scrolls. */
const MAX_INPUT_HEIGHT = 140;

/**
 * The message composer: auto-growing textarea, @mentions, emoji picker,
 * attachments (drag & drop, picker), voice and video messages, replies and
 * send-failure feedback.
 */
export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
	channel,
	channelKey,
	replyTo,
	onCancelReply,
	messages,
}) => {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const theme = useAppStore((state) => state.theme);
	const isSmall = useMediaQuery('(max-width: 400px)');

	const [inputText, setInputText] = useState('');
	const [sending, setSending] = useState(false);
	const [showEmoji, setShowEmoji] = useState(false);
	const [showVideoRecorder, setShowVideoRecorder] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);

	const inputRef = useRef<HTMLTextAreaElement>(null);

	const attachments = useAttachments();
	const filePicker = useFilePicker(attachments.add);
	const mentions = useMentions(channel.id, inputRef);
	const sendText = useSendText(channel.id);
	const isDragging = useFileDrop(attachments.add);
	const { sendVoice, sendVideo } = useSendMedia({
		channel,
		channelKey,
		replyTo,
		onCancelReply,
		onError: setSendError,
		onQueueFile: (file) => attachments.add([file]),
		setSending,
	});

	const isDirect = isDirectMessage(channel);
	const displayName = getChannelDisplayName(channel, user?.id || '');
	const target = `${isDirect ? '@' : '#'}${displayName}`;
	const iconSize = isSmall ? 18 : 22;

	const handleSend = useCallback(async () => {
		const text = inputText.trim();
		if ((!text && attachments.files.length === 0) || sending) return;
		setSending(true);
		setSendError(null);

		try {
			await attachments.sendAll(channel.id, channelKey);
			if (text) sendText(text, replyTo?.id);

			setInputText('');
			if (replyTo) onCancelReply?.();
			if (inputRef.current) inputRef.current.style.height = 'auto';
		} catch (err) {
			logger.error('Failed to send messages', { error: String(err) });
			setSendError(t('composer.errors.send_failed'));
		} finally {
			setSending(false);
			inputRef.current?.focus();
		}
	}, [inputText, attachments, sending, channel.id, channelKey, replyTo, onCancelReply, sendText, t]);

	const retryFile = useCallback(
		(id: string) => {
			attachments.reset(id);
			// Re-run the send on the next tick so it sees the reset status.
			setTimeout(() => handleSend(), 0);
		},
		[attachments, handleSend],
	);

	const insertMention = (username: string) => {
		const cursor = inputRef.current?.selectionStart || 0;
		const next = mentions.pick(inputText, cursor, username);
		setInputText(next.text);
		setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.setSelectionRange(next.cursor, next.cursor);
		}, 0);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const result = mentions.handleKey(e);
		if (result === 'handled') return;
		if (result) {
			insertMention(result.pick.username);
			return;
		}

		if (e.key === 'Escape' && replyTo) {
			e.preventDefault();
			onCancelReply?.();
			return;
		}

		// ArrowUp in an empty box edits the last own text message.
		if (e.key === 'ArrowUp' && inputText === '' && !mentions.isOpen) {
			e.preventDefault();
			const lastOwn = [...messages]
				.reverse()
				.find((m) => m.sender_id === user?.id && m.type === 'text');
			if (lastOwn) {
				window.dispatchEvent(new CustomEvent('edit-message', { detail: { messageId: lastOwn.id } }));
			}
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const { value, selectionStart } = e.target;
		setInputText(value);
		e.target.style.height = 'auto';
		e.target.style.height = Math.min(e.target.scrollHeight, MAX_INPUT_HEIGHT) + 'px';
		mentions.track(value, selectionStart);
	};

	const handleEmojiSelect = (emoji: { native: string }) => {
		setInputText((prev) => prev + emoji.native);
		setShowEmoji(false);
		inputRef.current?.focus();
	};

	useEffect(() => {
		inputRef.current?.focus();
	}, [replyTo, channel.id]);

	const canSend = (inputText.trim() !== '' || attachments.files.length > 0) && !sending;
	const iconButtonClass =
		'group flex cursor-pointer items-center justify-center rounded-full p-1 text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground';

	return (
		<div className={cn('relative shrink-0', isSmall ? 'px-2 pb-4 pt-1' : 'px-4 pb-4 pt-2')}>
			{isDragging && <DropOverlay target={target} compact={isSmall} />}

			{sendError && <SendErrorBanner message={sendError} onDismiss={() => setSendError(null)} />}

			{replyTo && (
				<ReplyPreview
					message={replyTo}
					senderName={channel.member_names?.[replyTo.sender_id] || replyTo.sender_id}
					onCancel={onCancelReply}
				/>
			)}

			<div
				className={cn(
					'relative flex flex-col overflow-hidden rounded-lg border border-border bg-secondary text-flat transition-all',
					replyTo && 'rounded-t-none border-t-0',
				)}
			>
				{attachments.files.length > 0 && (
					<AttachmentPreviews
						items={attachments.files}
						onRemove={attachments.remove}
						onRetry={retryFile}
					/>
				)}

				<div className={cn('flex items-start', isSmall ? 'gap-2 px-2 py-2' : 'gap-3 px-4 py-2.5')}>
					<AttachMenu compact={isSmall} onPick={filePicker.open} />
					<input {...filePicker.inputProps} />

					<textarea
						ref={inputRef}
						data-chat-input
						className="max-h-[140px] min-h-[24px] flex-1 resize-none border-none bg-transparent pb-0 pt-[3px] text-[15px] leading-6 text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/60 focus:ring-0"
						placeholder={isSmall ? t('composer.message_short') : t('composer.message_to', { target })}
						aria-label={t('composer.message_to', { target })}
						value={inputText}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						rows={1}
						dir="auto"
					/>

					<div className={cn('flex shrink-0 items-center', isSmall ? 'gap-1' : 'gap-1.5')}>
						<VoiceRecorder
							channelId={channel.id}
							onFile={(file) => attachments.add([file])}
							onSendVoice={sendVoice}
							size={iconSize}
						/>
						<button
							type="button"
							onClick={() => setShowVideoRecorder(true)}
							className={iconButtonClass}
							title={t('composer.record_video')}
							aria-label={t('composer.record_video')}
						>
							<Video size={iconSize} className="transition-transform group-hover:scale-110" />
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setShowEmoji((v) => !v);
							}}
							className={iconButtonClass}
							title={t('composer.add_emoji')}
							aria-label={t('composer.add_emoji')}
						>
							<Smile size={iconSize} className="transition-transform group-hover:scale-110" />
						</button>
						<button
							type="button"
							onClick={handleSend}
							disabled={!canSend}
							className={cn(iconButtonClass, 'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground')}
							title={t('composer.send')}
							aria-label={t('composer.send')}
						>
							{sending ? (
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

			{mentions.isOpen && (
				<MentionPopup
					query={mentions.query}
					members={mentions.filtered}
					selectedIndex={mentions.selectedIndex}
					onHover={mentions.setSelectedIndex}
					onPick={insertMention}
				/>
			)}

			{showEmoji && (
				<div className="absolute bottom-[70px] end-6 z-50">
					<EmojiPicker
						onSelect={handleEmojiSelect}
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
