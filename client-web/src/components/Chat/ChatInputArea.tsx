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
} from 'lucide-react';
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
	const [inputText, setInputText] = useState('');
	const [sending, setSending] = useState(false);
	const [showEmoji, setShowEmoji] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [files, setFiles] = useState<
		{
			file: File;
			id: string;
			status: 'idle' | 'encrypting' | 'uploading' | 'done';
			progress: number;
		}[]
	>([]);

	const [members, setMembers] = useState<{ id: string; username: string }[]>(
		[],
	);
	const [mentionSearch, setMentionSearch] = useState<string | null>(null);
	const [mentionPopupOpen, setMentionPopupOpen] = useState(false);
	const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const updateFileStatus = (id: string, status: any, progress: number = 0) => {
		setFiles((prev) =>
			prev.map((f) => (f.id === id ? { ...f, status, progress } : f)),
		);
	};

	const removeFile = (id: string) => {
		setFiles((prev) => prev.filter((f) => f.id !== id));
	};
	const addFiles = (newFiles: File[]) => {
		setFiles((prev) => [
			...prev,
			...newFiles.map((f) => ({
				file: f,
				id: Math.random().toString(36).substring(7),
				status: 'idle' as const,
				progress: 0,
			})),
		]);
	};
	const handleSend = useCallback(async () => {
		const text = inputText.trim();
		if ((!text && files.length === 0) || sending) return;
		setSending(true);

		try {
			// Handle file uploads first
			for (const f of files) {
				updateFileStatus(f.id, 'encrypting', 30);
				const processed = await encryptAndCompressFile(f.file, channelKey);

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

				const fileMetadata = JSON.stringify({
					file_id: (res as any).id,
					name: f.file.name,
					mime: processed.mimeType,
					size: processed.originalSize,
					nonce: bytesToBase64(processed.nonce),
					thumb_ciphertext: processed.thumbnailCipher
						? bytesToBase64(processed.thumbnailCipher)
						: undefined,
					thumb_nonce: processed.thumbnailNonce
						? bytesToBase64(processed.thumbnailNonce)
						: undefined,
				});

				await wsSendMessage(channel.id, fileMetadata, 'file', 'zstd');
				updateFileStatus(f.id, 'done', 100);
				playNotificationSound('file-upload');
			}

			if (text) {
				await wsSendMessage(channel.id, text, 'text', 'none', replyTo?.id);
			}

			setInputText('');
			setFiles([]);
			if (replyTo) onCancelReply?.();
			if (inputRef.current) {
				inputRef.current.style.height = 'auto';
			}
		} catch (err) {
			console.error('Failed to send messages:', err);
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
	]);

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

			{/* Reply Preview */}
			{replyTo && (
				<div className="bg-background/40 backdrop-blur-md border-x border-t border-border rounded-t-lg px-4 py-2 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2 duration-150">
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
				className={`bg-secondary/50 rounded-lg flex flex-col relative focus-within:ring-0 transition-all overflow-hidden border border-border text-flat ${replyTo ? 'rounded-t-none border-t-0' : ''}`}
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

								{f.file.type.startsWith('image/') ? (
									<img
										src={URL.createObjectURL(f.file)}
										alt="preview"
										className={`w-full h-full object-cover rounded ${f.status !== 'idle' && f.status !== 'done' ? 'blur-sm opacity-50' : ''}`}
									/>
								) : (
									<div className="flex flex-col items-center gap-1">
										<FileIcon size={32} className="text-[#949ba4]" />
										<span className="text-[10px] text-[#949ba4] truncate w-20 text-center">
											{f.file.name}
										</span>
									</div>
								)}

								{/* Progress UI - Kept but simplified */}
								{f.status !== 'idle' && f.status !== 'done' && (
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
								)}
							</div>
						))}
					</div>
				)}

				<div
					className={`flex items-start ${isSmall ? 'px-2 py-2 gap-2' : 'px-4 py-2.5 gap-3'}`}
				>
					<button
						onClick={() => fileInputRef.current?.click()}
						className="mt-0.5 text-muted-foreground hover:text-foreground transition"
					>
						<Plus
							className={`bg-muted-foreground/10 rounded-full p-1 ${isSmall ? 'w-5 h-5' : 'w-6 h-6'} hover:bg-muted-foreground/20`}
						/>
					</button>
					<input
						type="file"
						ref={fileInputRef}
						className="hidden"
						multiple
						onChange={(e) =>
							e.target.files && addFiles(Array.from(e.target.files))
						}
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
							size={isSmall ? 18 : 24}
						/>
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
		</div>
	);
};
