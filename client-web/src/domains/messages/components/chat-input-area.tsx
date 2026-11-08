import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smile } from 'lucide-react';

import VoiceRecorder from '@/domains/recording/components/voice-recorder';
import { ComposerActionButton } from '@/domains/recording/components/composer-action-button';
import { VideoMessageRecorderModal } from '@/domains/recording/components/video-message-recorder-modal';
import { useAuthStore, getChannelDisplayName } from '@/store/store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isDirectMessage } from '@/utils/channel';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import type { Channel, Message } from '@/types/api';
import { useAttachments } from '../hooks/use-attachments';
import { useComposerDrafts } from '../store/composer-drafts.store';
import { useFileDrop } from '../hooks/use-file-drop';
import { useMentions } from '../hooks/use-mentions';
import { useSendMedia } from '../hooks/use-send-media';
import { useSendText } from '../hooks/use-send-text';
import { AttachMenu } from '@/components/attach-menu';
import { useFilePicker } from '@/hooks/use-file-picker';
import { AttachmentPreviews } from './attachment-previews';
import { DropOverlay, ReplyPreview, SendErrorBanner } from './composer-banners';
import { MentionPopup } from './mention-popup';
import { ComposerEmojiPanel } from './composer-emoji-panel';
import { preloadComposerEmojiPanel, preloadComposerEmojiPanelWhenIdle } from '../utils/emoji-panel-loader';
import { insertAtSelection } from '@/domains/emoji/utils/insert-text';
import type { EmojiPickInfo } from '@/domains/emoji/components/emoji-picker-body';
import { useSendSticker } from '../hooks/use-send-sticker';
import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import { useShortcodeAutocomplete } from '@/domains/emoji/hooks/use-shortcode-autocomplete';
import { ShortcodePopup } from '@/domains/emoji/components/shortcode-popup';
import type { PackItem } from '@/domains/stickers/types/stickers.types';

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
	const { supports } = useServerCapabilities();
	const isSmall = useMediaQuery('(max-width: 400px)');
	const isTiny = useMediaQuery('(max-width: 340px)');

	// Unsent text lives in a per-chat store so it survives the layout switching between phone and desktop widths,
	// which remounts this component.
	const inputText = useComposerDrafts((s) => s.drafts[channel.id]?.text ?? '');
	const setDraftText = useComposerDrafts((s) => s.setText);
	const setInputText = useCallback(
		(next: string | ((prev: string) => string)) => {
			const current = useComposerDrafts.getState().drafts[channel.id]?.text ?? '';
			setDraftText(channel.id, typeof next === 'function' ? next(current) : next);
		},
		[channel.id, setDraftText],
	);
	const [sending, setSending] = useState(false);
	const [showEmoji, setShowEmoji] = useState(false);
	// The panel is built on first open and then kept (hidden) so reopening is instant and keeps its scroll position.
	const [emojiMounted, setEmojiMounted] = useState(false);
	const openEmoji = (open: boolean) => {
		if (open) setEmojiMounted(true);
		setShowEmoji(open);
	};
	useEffect(() => preloadComposerEmojiPanelWhenIdle(), []);
	const [showVideoRecorder, setShowVideoRecorder] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);

	const inputRef = useRef<HTMLTextAreaElement>(null);

	const attachments = useAttachments(channel.id);
	const filePicker = useFilePicker(attachments.add);
	const mentions = useMentions(channel.id, inputRef);
	const sendText = useSendText(channel.id);
	const sendSticker = useSendSticker(channel.id);
	const shortcodes = useShortcodeAutocomplete();
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
	const iconSize = isTiny ? 17 : isSmall ? 18 : 22;

	const handleSend = useCallback(async () => {
		const text = inputText.trim();
		if ((!text && attachments.files.length === 0) || sending) return;
		setSending(true);
		setSendError(null);
		setShowEmoji(false);

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
	}, [inputText, attachments, sending, channel.id, channelKey, replyTo, onCancelReply, sendText, setInputText, t]);

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

	const insertShortcode = (name: string) => {
		const cursor = inputRef.current?.selectionStart ?? inputText.length;
		const next = shortcodes.pick(inputText, cursor, name);
		setInputText(next.text);
		setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.setSelectionRange(next.cursor, next.cursor);
		}, 0);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const shortcode = shortcodes.handleKey(e);
		if (shortcode === 'handled') return;
		if (shortcode) {
			insertShortcode(shortcode.pick.name);
			return;
		}
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
		shortcodes.track(value, selectionStart);
	};

	/** Inserts at the caret (replacing a selection) and keeps the panel open for the next emoji. */
	const handleEmojiSelect = (text: string, info: EmojiPickInfo) => {
		const ta = inputRef.current;
		const current = useComposerDrafts.getState().drafts[channel.id]?.text ?? '';
		const next = insertAtSelection(current, ta?.selectionStart, ta?.selectionEnd, text);
		setInputText(next.text);
		if (!ta) return;
		// The composer keeps focus on mouse picks (the panel does not take it); keyboard picks leave focus in the panel.
		requestAnimationFrame(() => {
			if (!info.keyboard) ta.focus();
			ta.setSelectionRange(next.caret, next.caret);
		});
	};

	const handleStickerSelect = async (packId: string, item: PackItem) => {
		openEmoji(false);
		const ok = await sendSticker(packId, item, replyTo?.id);
		if (!ok) {
			setSendError(t('composer.errors.send_failed'));
			return;
		}
		if (replyTo) onCancelReply?.();
		inputRef.current?.focus();
	};

	useEffect(() => {
		inputRef.current?.focus();
	}, [replyTo, channel.id]);

	// A restored draft arrives with the text already set, so the textarea has to grow to fit it (typing does this itself).
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + 'px';
	}, [inputText]);

	const hasContent = inputText.trim() !== '' || attachments.files.length > 0;
	const iconButtonClass =
		'group flex cursor-pointer items-center justify-center rounded-full p-1 text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground';

	return (
		<div className={cn(
				'relative shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]',
				isSmall ? 'px-2 pt-1' : 'px-4 pt-2',
			)}>
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

				<div className={cn('flex items-start', isTiny ? 'gap-1.5 px-1.5 py-2' : isSmall ? 'gap-2 px-2 py-2' : 'gap-3 px-4 py-2.5')}>
					<AttachMenu compact={isSmall} onPick={filePicker.open} />
					<input {...filePicker.inputProps} />

					<textarea
						ref={inputRef}
						data-chat-input
						className="max-h-[140px] min-h-[24px] min-w-0 flex-1 resize-none border-none bg-transparent pb-0 pt-[3px] text-[15px] leading-6 text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/60 focus:ring-0"
						placeholder={isSmall ? t('composer.message_short') : t('composer.message_to', { target })}
						aria-label={t('composer.message_to', { target })}
						value={inputText}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						rows={1}
						dir="auto"
					/>

					<div className={cn('flex shrink-0 items-center', isTiny ? 'gap-0' : isSmall ? 'gap-1' : 'gap-1.5')}>
						<button
								type="button"
								data-emoji-toggle
								onMouseEnter={() => void preloadComposerEmojiPanel()}
								onFocus={() => void preloadComposerEmojiPanel()}
								// Keep the caret in the composer when the button is pressed.
								onMouseDown={(e) => e.preventDefault()}
								onClick={(e) => {
									e.stopPropagation();
									openEmoji(!showEmoji);
								}}
								className={iconButtonClass}
								title={t('composer.add_emoji')}
								aria-label={t('composer.add_emoji')}
							>
								<Smile size={iconSize} className="transition-transform group-hover:scale-110" />
							</button>
							<VoiceRecorder
								channelId={channel.id}
								onFile={(file) => attachments.add([file])}
								onSendVoice={sendVoice}
								size={iconSize}
								renderIdle={(start) => (
									<ComposerActionButton
										hasContent={hasContent}
										sending={sending}
										size={iconSize}
										onSend={handleSend}
										onRecordVoice={start}
										onRecordVideo={() => setShowVideoRecorder(true)}
										sendLabel={t('composer.send')}
									/>
								)}
							/>
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

			{shortcodes.isOpen && (
				<ShortcodePopup
					query={shortcodes.query}
					items={shortcodes.matches}
					selectedIndex={shortcodes.selectedIndex}
					onHover={shortcodes.setSelectedIndex}
					onPick={insertShortcode}
				/>
			)}

			{emojiMounted && (
				<div className="absolute bottom-[70px] end-2 z-50 w-[min(352px,calc(100vw-1rem))] sm:end-6">
					<ComposerEmojiPanel
						open={showEmoji}
						stickersEnabled={supports('stickers')}
						onEmoji={handleEmojiSelect}
						onSticker={handleStickerSelect}
						onClose={() => openEmoji(false)}
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
