import React, {
	useState,
	useRef,
	useCallback,
	useEffect,
	useMemo,
} from 'react';
import {
	Plus,
	X,
	FileIcon,
	Loader2,
	Smile,
	SendHorizontal,
	Lock,
	AtSign,
	Reply as ReplyIcon,
	ImageIcon,
	Music,
	FileText,
	Video,
	AlertCircle,
} from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
	useAuthStore,
	getChannelDisplayName,
	useAppStore,
} from '@/store/store';
import { apiGetChannelMembers } from '@/api/client';
import { Avatar } from '../Avatar';
import EmojiPicker from '../EmojiPicker';
import VoiceRecorder from '../VoiceRecorder';
import type { Channel, Message } from '@/types/api';
import { apiUploadFile } from '@/api/client';
import { encryptAndCompressFile } from '@/utils/file';
import { wsSendMessage } from '@/ws';
import { bytesToBase64 } from '@/ws';
import { isDirectMessage } from '@/utils/channel';
import { playNotificationSound } from '@/utils/notifications';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { db } from '@/lib/db';
import { VideoMessageRecorderModal } from './VideoMessageRecorderModal';
import { useQueryClient } from '@tanstack/react-query';
import {
	addPendingMessage,
	markPendingFailed,
	removePendingMessage,
	isPendingStillSending,
} from '@/utils/pendingMessages';

const SEND_TIMEOUT_MS = 10_000;

interface ChatInputAreaProps {
	channel: Channel;
	channelKey: Uint8Array;
	replyTo?: (Message & { text?: string }) | null;
	onCancelReply?: () => void;
	messages: (Message & { text?: string })[];
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
	channel,
	channelKey,
	replyTo,
	onCancelReply,
	messages,
}) => {
	const user = useAuthStore((state) => state.user);
	const theme = useAppStore((state) => state.theme);
	const queryClient = useQueryClient();
	const [inputText, setInputText] = useState('');
	const [sending, setSending] = useState(false);
	const [showEmoji, setShowEmoji] = useState(false);
	const [showVideoRecorder, setShowVideoRecorder] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [files, setFiles] = useState<
		{
			file: File;
			id: string;
			status: 'idle' | 'encrypting' | 'uploading' | 'done' | 'failed';
			progress: number;
			asDocument?: boolean;
			error?: string;
		}[]
	>([]);
	const [sendError, setSendError] = useState<string | null>(null);

	const [members, setMembers] = useState<{ id: string; username: string }[]>(
		[],
	);
	const [mentionSearch, setMentionSearch] = useState<string | null>(null);
	const [mentionPopupOpen, setMentionPopupOpen] = useState(false);
	const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const videoMessageInputRef = useRef<HTMLInputElement>(null);
	const uploadAsDocumentRef = useRef(false);

	const triggerUpload = (mode: 'media' | 'audio' | 'file') => {
		if (!fileInputRef.current) return;
		uploadAsDocumentRef.current = mode === 'file';
		if (mode === 'media') {
			fileInputRef.current.accept = 'image/*,video/*';
		} else if (mode === 'audio') {
			fileInputRef.current.accept = 'audio/*';
		} else {
			fileInputRef.current.accept = '*/*';
		}
		fileInputRef.current.value = '';
		fileInputRef.current.click();
	};

	const updateFileStatus = (id: string, status: any, progress: number = 0, error?: string) => {
		setFiles((prev) =>
			prev.map((f) => (f.id === id ? { ...f, status, progress, error } : f)),
		);
	};

	const removeFile = (id: string) => {
		setFiles((prev) => prev.filter((f) => f.id !== id));
	};
	const addFiles = (newFiles: File[], asDocument: boolean = false) => {
		setFiles((prev) => [
			...prev,
			...newFiles.map((f) => ({
				file: f,
				id: Math.random().toString(36).substring(7),
				status: 'idle' as const,
				progress: 0,
				asDocument,
			})),
		]);
	};

	// Sends a text message with visible failure feedback: wsSendMessage()
	// always resolves even when the socket is disconnected (it's a silent
	// no-op deep in the socket layer), so without this a message typed while
	// offline would just vanish with no indication anything went wrong.
	const sendTextGuarded = useCallback(
		(text: string, replyToId?: string) => {
			const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			addPendingMessage(queryClient, channel.id, {
				id: localId,
				channel_id: channel.id,
				sender_id: user?.id || '',
				type: 'text',
				ciphertext: '',
				nonce: '',
				compression: 'none',
				sent_at: new Date().toISOString(),
				reply_to_id: replyToId,
				text,
				pending: 'sending',
				_retry: () => {
					removePendingMessage(queryClient, channel.id, localId);
					sendTextGuarded(text, replyToId);
				},
			} as any);

			if (useAppStore.getState().wsState !== 'connected') {
				markPendingFailed(queryClient, channel.id, localId);
				return;
			}

			wsSendMessage(channel.id, text, 'text', 'none', replyToId);

			setTimeout(() => {
				if (isPendingStillSending(queryClient, channel.id, localId)) {
					markPendingFailed(queryClient, channel.id, localId);
				}
			}, SEND_TIMEOUT_MS);
		},
		[channel.id, user?.id, queryClient],
	);
	const handleSend = useCallback(async () => {
		const text = inputText.trim();
		if ((!text && files.length === 0) || sending) return;
		setSending(true);
		setSendError(null);

		try {
			// Handle file uploads first — each file fails independently so one
			// bad upload doesn't silently swallow the rest of the batch.
			for (const f of files) {
				try {
					updateFileStatus(f.id, 'encrypting', 30);
					const processed = await encryptAndCompressFile(f.file, channelKey, {
						asDocument: f.asDocument,
					});

					updateFileStatus(f.id, 'uploading', 0);

					const res = await apiUploadFile(
						new Blob([processed.ciphertext as any], { type: processed.mimeType }),
						processed.mimeType,
						processed.thumbnailCipher
							? bytesToBase64(processed.thumbnailCipher)
							: undefined,
						processed.thumbnailNonce
							? bytesToBase64(processed.thumbnailNonce)
							: undefined,
						(progressEvent) => {
							const percent = Math.round(
								(progressEvent.loaded * 100) / progressEvent.total,
							);
							updateFileStatus(f.id, 'uploading', percent);
						},
						channel.id,
					);

					const fileId = (res as any).id;
					// Immediately cache unencrypted file so sender sees it in opened state without downloading
					try {
						await db.cacheFile(
							fileId,
							processed.rawBytes,
							processed.mimeType,
							processed.originalSize,
						);
					} catch (cacheErr) {
						console.warn('Failed to pre-cache uploaded file:', cacheErr);
					}

					const fileMetadata = JSON.stringify({
						file_id: fileId,
						name: processed.fileName || f.file.name,
						mime: processed.mimeType,
						size: processed.originalSize,
						nonce: bytesToBase64(processed.nonce),
						thumb_ciphertext: processed.thumbnailCipher
							? bytesToBase64(processed.thumbnailCipher)
							: undefined,
						thumb_nonce: processed.thumbnailNonce
							? bytesToBase64(processed.thumbnailNonce)
							: undefined,
						as_document: f.asDocument ? true : undefined,
					});

					if (useAppStore.getState().wsState !== 'connected') {
						updateFileStatus(f.id, 'failed', 100, 'Not connected — tap to retry');
						continue;
					}

					await wsSendMessage(channel.id, fileMetadata, 'file', 'zstd');
					updateFileStatus(f.id, 'done', 100);
					playNotificationSound('file-upload');
				} catch (fileErr: any) {
					console.error('Failed to send file:', fileErr);
					updateFileStatus(f.id, 'failed', 0, fileErr?.message || 'Failed to send');
				}
			}

			// Drop successfully-sent files, keep failed ones visible for retry.
			setFiles((prev) => prev.filter((f) => f.status === 'failed'));

			if (text) {
				sendTextGuarded(text, replyTo?.id);
			}

			setInputText('');
			if (replyTo) onCancelReply?.();
			if (inputRef.current) {
				inputRef.current.style.height = 'auto';
			}
		} catch (err) {
			console.error('Failed to send messages:', err);
			setSendError('Failed to send. Please try again.');
		} finally {
			setSending(false);
			inputRef.current?.focus();
		}
	}, [
		inputText,
		files,
		sending,
		channel.id,
		channelKey,
		replyTo,
		onCancelReply,
		sendTextGuarded,
	]);

	const retryFile = useCallback((id: string) => {
		updateFileStatus(id, 'idle', 0, undefined);
		// Re-run handleSend on next tick so it picks up the reset status.
		setTimeout(() => handleSend(), 0);
	}, [handleSend]);

	const handleDirectVoiceSend = useCallback(
		async (voiceFile: File, voiceDuration?: number) => {
			try {
				const processed = await encryptAndCompressFile(voiceFile, channelKey);
				const res = await apiUploadFile(
					new Blob([processed.ciphertext as any], { type: processed.mimeType }),
					processed.mimeType,
					processed.thumbnailCipher
						? bytesToBase64(processed.thumbnailCipher)
						: undefined,
					processed.thumbnailNonce
						? bytesToBase64(processed.thumbnailNonce)
						: undefined,
					undefined,
					channel.id,
				);

				const fileId = (res as any).id;
				// Immediately cache voice file so sender sees it in opened state
				try {
					await db.cacheFile(
						fileId,
						processed.rawBytes,
						processed.mimeType,
						processed.originalSize,
					);
				} catch (cacheErr) {
					console.warn('Failed to pre-cache voice file:', cacheErr);
				}

				const fileMetadata = JSON.stringify({
					file_id: fileId,
					name: voiceFile.name,
					mime: processed.mimeType,
					size: processed.originalSize,
					duration: voiceDuration ? Math.round(voiceDuration) : undefined,
					nonce: bytesToBase64(processed.nonce),
					thumb_ciphertext: processed.thumbnailCipher
						? bytesToBase64(processed.thumbnailCipher)
						: undefined,
					thumb_nonce: processed.thumbnailNonce
						? bytesToBase64(processed.thumbnailNonce)
						: undefined,
				});

				if (useAppStore.getState().wsState !== 'connected') {
					setSendError('Not connected — voice message not sent.');
					addFiles([voiceFile]);
					return;
				}

				await wsSendMessage(channel.id, fileMetadata, 'voice', 'none', replyTo?.id);
				playNotificationSound('message');
				if (replyTo) onCancelReply?.();
			} catch (err) {
				console.error('Failed to send direct voice message:', err);
				setSendError('Failed to send voice message.');
				// Fallback to adding to files queue if direct send fails
				addFiles([voiceFile]);
			}
		},
		[channel.id, channelKey, replyTo, onCancelReply],
	);

	const checkVideoDuration = (file: File): Promise<number> => {
		return new Promise((resolve, reject) => {
			const video = document.createElement('video');
			video.preload = 'metadata';
			video.onloadedmetadata = () => {
				window.URL.revokeObjectURL(video.src);
				resolve(video.duration);
			};
			video.onerror = () => {
				window.URL.revokeObjectURL(video.src);
				reject(new Error('Failed to load video metadata'));
			};
			video.src = URL.createObjectURL(file);
		});
	};

	const handleDirectVideoSend = useCallback(
		async (videoFile: File) => {
			if (videoFile.size > 50 * 1024 * 1024) {
				alert('Video message exceeds maximum file size of 50MB');
				return;
			}

			try {
				const dur = await checkVideoDuration(videoFile);
				if (dur > 60) {
					alert(
						`Video messages cannot exceed 60 seconds (duration: ${Math.round(dur)}s)`,
					);
					return;
				}

				setSending(true);
				const processed = await encryptAndCompressFile(videoFile, channelKey);
				const res = await apiUploadFile(
					new Blob([processed.ciphertext as any], { type: processed.mimeType }),
					processed.mimeType,
					processed.thumbnailCipher
						? bytesToBase64(processed.thumbnailCipher)
						: undefined,
					processed.thumbnailNonce
						? bytesToBase64(processed.thumbnailNonce)
						: undefined,
					undefined,
					channel.id,
					true,
				);

				const fileId = (res as any).id;
				try {
					await db.cacheFile(
						fileId,
						processed.rawBytes,
						processed.mimeType,
						processed.originalSize,
					);
				} catch (cacheErr) {
					console.warn('Failed to pre-cache video message:', cacheErr);
				}

				const fileMetadata = JSON.stringify({
					file_id: fileId,
					name: videoFile.name,
					mime: processed.mimeType,
					size: processed.originalSize,
					duration: Math.round(dur),
					nonce: bytesToBase64(processed.nonce),
					thumb_ciphertext: processed.thumbnailCipher
						? bytesToBase64(processed.thumbnailCipher)
						: undefined,
					thumb_nonce: processed.thumbnailNonce
						? bytesToBase64(processed.thumbnailNonce)
						: undefined,
					processing_status: 'processing',
				});

				if (useAppStore.getState().wsState !== 'connected') {
					setSendError('Not connected — video message not sent.');
					return;
				}

				await wsSendMessage(channel.id, fileMetadata, 'video', 'none', replyTo?.id);
				playNotificationSound('message');
				if (replyTo) onCancelReply?.();
			} catch (err: any) {
				console.error('Failed to send video message:', err);
				setSendError(err.message || 'Failed to send video message.');
			} finally {
				setSending(false);
			}
		},
		[channel.id, channelKey, replyTo, onCancelReply],
	);

	const insertMention = useCallback(
		(username: string) => {
			const cursor = inputRef.current?.selectionStart || 0;
			const textBeforeCursor = inputText.substring(0, cursor);
			const textAfterCursor = inputText.substring(cursor);
			const lastAt = textBeforeCursor.lastIndexOf('@');

			const newText =
				textBeforeCursor.substring(0, lastAt) +
				'@' +
				username +
				' ' +
				textAfterCursor;
			setInputText(newText);
			setMentionPopupOpen(false);
			setMentionSearch(null);

			// Focus back and set cursor
			setTimeout(() => {
				if (inputRef.current) {
					const newPos = lastAt + username.length + 2;
					inputRef.current.focus();
					inputRef.current.setSelectionRange(newPos, newPos);
				}
			}, 0);
		},
		[inputText],
	);

	const filteredMembers = useMemo(() => {
		return members.filter(
			(m) =>
				m.id !== user?.id &&
				m.username.toLowerCase().includes(mentionSearch?.toLowerCase() || ''),
		);
	}, [members, user?.id, mentionSearch]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (mentionPopupOpen) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedMentionIndex((prev) => (prev + 1) % filteredMembers.length);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedMentionIndex(
					(prev) =>
						(prev - 1 + filteredMembers.length) % filteredMembers.length,
				);
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				if (filteredMembers[selectedMentionIndex]) {
					e.preventDefault();
					insertMention(filteredMembers[selectedMentionIndex].username);
					return;
				}
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				setMentionPopupOpen(false);
				return;
			}
		}

		if (e.key === 'Escape' && replyTo) {
			e.preventDefault();
			onCancelReply?.();
			return;
		}

		if (e.key === 'ArrowUp' && inputText === '' && !mentionPopupOpen) {
			e.preventDefault();
			const lastOwnMessage = [...messages]
				.reverse()
				.find((m) => m.sender_id === user?.id && m.type === 'text');
			if (lastOwnMessage) {
				window.dispatchEvent(
					new CustomEvent('edit-message', {
						detail: { messageId: lastOwnMessage.id },
					}),
				);
			}
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleEmojiSelect = (emoji: { native: string }) => {
		setInputText((prev) => prev + emoji.native);
		setShowEmoji(false);
		inputRef.current?.focus();
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const value = e.target.value;
		setInputText(value);
		e.target.style.height = 'auto';
		e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';

		// Mention logic
		const cursor = e.target.selectionStart;
		const textBeforeCursor = value.substring(0, cursor);
		const lastAt = textBeforeCursor.lastIndexOf('@');

		if (lastAt !== -1) {
			const query = textBeforeCursor.substring(lastAt + 1);
			// Only trigger if @ is at start or preceded by space
			if (lastAt === 0 || textBeforeCursor[lastAt - 1] === ' ') {
				if (!query.includes(' ')) {
					setMentionSearch(query);
					setMentionPopupOpen(true);
					setSelectedMentionIndex(0);
					return;
				}
			}
		}
		setMentionPopupOpen(false);
		setMentionSearch(null);
	};

	useEffect(() => {
		if (channel.id) {
			apiGetChannelMembers(channel.id).then(setMembers).catch(console.error);
		}
	}, [channel.id]);

	useEffect(() => {
		if (replyTo || channel.id) {
			inputRef.current?.focus();
		}
	}, [replyTo, channel.id]);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (mentionPopupOpen && !inputRef.current?.contains(e.target as Node)) {
				setMentionPopupOpen(false);
			}
		};
		window.addEventListener('mousedown', handleClickOutside);
		return () => window.removeEventListener('mousedown', handleClickOutside);
	}, [mentionPopupOpen]);

	useEffect(() => {
		const onDragOver = (e: DragEvent) => {
			e.preventDefault();
			setIsDragging(true);
		};
		const onDragLeave = (e: DragEvent) => {
			if (e.relatedTarget === null) setIsDragging(false);
		};
		const onDrop = (e: DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (e.dataTransfer?.files) {
				addFiles(Array.from(e.dataTransfer.files));
			}
		};

		window.addEventListener('dragover', onDragOver);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('drop', onDrop);
		};
	}, []);

	const isDirect = isDirectMessage(channel);
	const displayName = getChannelDisplayName(channel, user?.id || '');
	const prefix = isDirect ? '@' : '#';

	const isSmall = useMediaQuery('(max-width: 400px)');

	return (
		<div
			className={`${isSmall ? 'px-2 pb-4 pt-1' : 'px-4 pb-6 pt-2'} shrink-0 relative`}
		>
			{/* Global Drag & Drop Overlay - Discord Like */}
			{isDragging && (
				<div className="fixed inset-0 bg-primary/20 border-4 border-dashed border-primary z-[999] flex items-center justify-center backdrop-blur-sm pointer-events-none transition-all animate-in fade-in duration-200">
					<div className="bg-background p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-2 border border-primary/30">
						<Plus size={isSmall ? 32 : 48} className="text-primary" />
						<span
							className={`text-foreground font-bold ${isSmall ? 'text-lg' : 'text-xl'}`}
						>
							Upload to {prefix}
							{displayName}
						</span>
					</div>
				</div>
			)}

			{/* Send Error Banner */}
			{sendError && (
				<div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-3 py-1.5 mb-1.5 flex items-center justify-between gap-2 text-[12px] font-medium animate-in slide-in-from-bottom-2 duration-150">
					<div className="flex items-center gap-1.5 min-w-0">
						<AlertCircle size={13} className="shrink-0" />
						<span className="truncate">{sendError}</span>
					</div>
					<button
						onClick={() => setSendError(null)}
						className="p-0.5 hover:bg-destructive/10 rounded-full transition-colors shrink-0"
						title="Dismiss"
					>
						<X size={12} />
					</button>
				</div>
			)}

			{/* Reply Preview */}
			{replyTo && (
				<div className="bg-secondary border-x border-t border-border rounded-t-lg px-4 py-2 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2 duration-150">
					<div className="flex items-center gap-2 min-w-0">
						<div className="flex items-center justify-center">
							<ReplyIcon size={14} className="text-muted-foreground shrink-0" />
						</div>
						<span className="text-[13px] text-muted-foreground">
							Replying to{' '}
							<span className="font-bold text-foreground hover:underline cursor-pointer">
								{channel.member_names?.[replyTo.sender_id] || replyTo.sender_id}
							</span>
						</span>
						<span className="text-[13px] text-muted-foreground/70 truncate italic border-l border-border pl-2">
							{replyTo.text || `[${replyTo.type}]`}
						</span>
					</div>
					<button
						onClick={onCancelReply}
						className="p-1 hover:bg-destructive/10 rounded-full transition-colors text-muted-foreground hover:text-destructive group"
						title="Cancel Reply"
					>
						<X
							size={14}
							className="group-hover:scale-110 transition-transform"
						/>
					</button>
				</div>
			)}

			<div
				className={`bg-secondary rounded-lg flex flex-col relative focus-within:ring-0 transition-all overflow-hidden border border-border text-flat ${replyTo ? 'rounded-t-none border-t-0' : ''}`}
			>
				{/* File Previews - Reverted Style */}
				{files.length > 0 && (
					<div className="flex gap-3 p-3 overflow-x-auto border-b border-border">
						{files.map((f) => (
							<div
								key={f.id}
								className="relative w-24 h-24 bg-accent/30 rounded-md flex flex-col items-center justify-center p-2 group shrink-0"
							>
								<button
									onClick={() => removeFile(f.id)}
									className="absolute -top-1 -right-1 bg-[#da373c] text-white rounded-full p-0.5 shadow-lg z-20 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<X size={14} />
								</button>

								{!f.asDocument && f.file.type.startsWith('image/') ? (
									<img
										src={URL.createObjectURL(f.file)}
										alt="preview"
										className={`w-full h-full object-cover rounded ${f.status !== 'idle' && f.status !== 'done' ? 'blur-sm opacity-50' : ''}`}
									/>
								) : (
									<div className="flex flex-col items-center gap-1">
										<FileIcon size={32} className="text-muted-foreground" />
										<span className="text-[10px] text-muted-foreground truncate w-20 text-center">
											{f.file.name}
										</span>
									</div>
								)}

								{/* Progress UI - Kept but simplified */}
								{f.status === 'failed' ? (
									<button
										type="button"
										onClick={() => retryFile(f.id)}
										className="absolute inset-0 bg-destructive/20 rounded-md flex flex-col items-center justify-center p-2 gap-1 cursor-pointer group/retry"
										title={f.error || 'Failed to send — tap to retry'}
									>
										<AlertCircle size={16} className="text-destructive" />
										<span className="text-[9px] text-destructive font-semibold group-hover/retry:underline">
											Retry
										</span>
									</button>
								) : (
									f.status !== 'idle' && f.status !== 'done' && (
										<div className="absolute inset-0 bg-background/80 rounded-md flex flex-col items-center justify-center p-2">
											{f.status === 'encrypting' ? (
												<Lock size={16} className="text-primary animate-pulse" />
											) : (
												<Loader2
													size={16}
													className="text-foreground animate-spin"
												/>
											)}
											<div className="w-full bg-black/40 h-1 rounded-full mt-2 overflow-hidden">
												<div
													className="bg-primary h-full transition-all duration-300"
													style={{ width: `${f.progress}%` }}
												/>
											</div>
										</div>
									)
								)}
							</div>
						))}
					</div>
				)}

				<div
					className={`flex items-start ${isSmall ? 'px-2 py-2 gap-2' : 'px-4 py-2.5 gap-3'}`}
				>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="mt-0.5 text-muted-foreground hover:text-foreground transition focus:outline-none"
								title="Add attachment"
							>
								<Plus
									className={`bg-muted-foreground/10 rounded-full p-1 ${isSmall ? 'w-5 h-5' : 'w-6 h-6'} hover:bg-muted-foreground/20`}
								/>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							side="top"
							sideOffset={8}
							className="w-44 bg-popover/95 backdrop-blur-md border-border shadow-xl rounded-xl p-1"
						>
							<DropdownMenuItem
								onClick={() => triggerUpload('media')}
								className="flex items-center gap-2.5 px-3 py-2 cursor-pointer rounded-lg text-sm font-medium hover:bg-accent text-foreground transition-colors"
							>
								<ImageIcon size={16} className="text-primary" />
								<span>Photo or Video</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => triggerUpload('audio')}
								className="flex items-center gap-2.5 px-3 py-2 cursor-pointer rounded-lg text-sm font-medium hover:bg-accent text-foreground transition-colors"
							>
								<Music size={16} className="text-primary" />
								<span>Audio</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => triggerUpload('file')}
								className="flex items-center gap-2.5 px-3 py-2 cursor-pointer rounded-lg text-sm font-medium hover:bg-accent text-foreground transition-colors"
							>
								<FileText size={16} className="text-primary" />
								<span>Document / File</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => setShowVideoRecorder(true)}
								className="flex items-center gap-2.5 px-3 py-2 cursor-pointer rounded-lg text-sm font-medium hover:bg-accent text-foreground transition-colors"
							>
								<Video size={16} className="text-primary" />
								<span>Video Message (max 1m)</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<input
						type="file"
						ref={fileInputRef}
						className="hidden"
						multiple
						onChange={(e) =>
							e.target.files &&
							addFiles(Array.from(e.target.files), uploadAsDocumentRef.current)
						}
					/>
					<input
						type="file"
						ref={videoMessageInputRef}
						accept="video/*"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) handleDirectVideoSend(file);
							e.target.value = '';
						}}
					/>

					<textarea
						ref={inputRef}
						className="flex-1 bg-transparent border-none outline-none text-foreground text-[15px] leading-6 resize-none min-h-[24px] max-h-[140px] placeholder-muted-foreground/60 py-0 shadow-none ring-0 focus:ring-0"
						placeholder={
							isSmall ? 'Message...' : `Message ${prefix}${displayName}`
						}
						value={inputText}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						rows={1}
						dir="auto"
					/>

					<div
						className={`flex items-center ${isSmall ? 'gap-1.5' : 'gap-3'} shrink-0 h-6`}
					>
						<VoiceRecorder
							channelId={channel.id}
							onFile={(file) => addFiles([file])}
							onSendVoice={handleDirectVoiceSend}
							size={isSmall ? 18 : 22}
						/>
						<button
							type="button"
							onClick={() => setShowVideoRecorder(true)}
							className="text-muted-foreground hover:text-foreground transition flex items-center justify-center cursor-pointer"
							title="Record Video Message"
						>
							<Video size={isSmall ? 18 : 22} />
						</button>
						<div className="relative flex items-center justify-center">
							<button
								onClick={(e) => {
									e.stopPropagation();
									setShowEmoji((v) => !v);
								}}
								className="text-muted-foreground hover:text-foreground transition flex items-center"
							>
								<Smile size={isSmall ? 20 : 24} />
							</button>
						</div>
						<button
							onClick={handleSend}
							disabled={(!inputText.trim() && files.length === 0) || sending}
							className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition"
						>
							{sending ? (
								<Loader2 size={isSmall ? 20 : 24} className="animate-spin" />
							) : (
								<SendHorizontal size={isSmall ? 20 : 24} />
							)}
						</button>
					</div>
				</div>
			</div>

			{/* Mention Popup */}
			{mentionPopupOpen && (
				<div className="absolute bottom-full left-4 mb-2 w-64 bg-popover rounded-lg shadow-2xl border border-border overflow-hidden z-[100] animate-in slide-in-from-bottom-2 duration-150">
					<div className="p-2 border-b border-border flex items-center gap-2 text-muted-foreground text-xs font-bold uppercase tracking-wider">
						<AtSign size={14} />
						Members matching "{mentionSearch}"
					</div>
					<div className="max-h-60 overflow-y-auto py-1">
						{filteredMembers.map((m, i) => (
							<button
								key={m.id}
								onClick={() => insertMention(m.username)}
								onMouseEnter={() => setSelectedMentionIndex(i)}
								className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
									i === selectedMentionIndex
										? 'bg-primary text-primary-foreground'
										: 'text-foreground hover:bg-accent'
								}`}
							>
								<Avatar userId={m.id} size={24} />
								<span className="font-medium">{m.username}</span>
							</button>
						))}
						{filteredMembers.length === 0 && (
							<div className="px-4 py-3 text-muted-foreground text-sm italic">
								No members found
							</div>
						)}
					</div>
				</div>
			)}

			{/* Emoji Picker */}
			{showEmoji && (
				<div className="absolute bottom-[70px] right-6 z-50">
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
				onSend={handleDirectVideoSend}
			/>
		</div>
	);
};
