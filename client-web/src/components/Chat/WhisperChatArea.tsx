import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
	Shield,
	ShieldCheck,
	Flame,
	X,
	Clock,
	FileText,
	Download,
	AlertCircle,
	Loader2,
	SendHorizontal,
	Plus,
	ImageIcon,
	Music,
	Video,
	Smile,
	ChevronDown,
	ChevronLeft,
	Lock,
} from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { Channel } from '@/types/api';
import { useWhisperStore, type WhisperMessageItem } from '@/store/whisperStore';
import {
	useAuthStore,
	useAppStore,
	useChannelStore,
	getChannelDisplayName,
} from '@/store/store';
import { formatFileSize } from '@/utils/file';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { decodeAudioBlob, extractWaveformPeaks } from '@/utils/audio';
import { Avatar } from '../Avatar';
import EmojiPicker from '../EmojiPicker';
import VoiceRecorder from '../VoiceRecorder';
import { VideoMessageRecorderModal } from './VideoMessageRecorderModal';
import { WhisperVoiceBubble } from './File/WhisperVoiceBubble';
import { WhisperVideoBubble } from './File/WhisperVideoBubble';
import { ChatBackgroundPattern } from './ChatBackgroundPattern';

interface WhisperChatAreaProps {
	channel: Channel;
}

function isGrouped(
	prev: WhisperMessageItem | undefined,
	curr: WhisperMessageItem,
): boolean {
	if (!prev) return false;
	return (
		prev.senderId === curr.senderId &&
		Math.abs(curr.sentAt - prev.sentAt) < 300_000 // 5 minutes
	);
}

function formatDate(timestamp: number): string {
	const d = new Date(timestamp);
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (d.toDateString() === today.toDateString()) return 'Today';
	if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
	return d.toLocaleDateString([], {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
	});
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatExpiryTime(expiresAt: number | null): string | null {
	if (!expiresAt) return null;
	const diffMs = expiresAt - Date.now();
	if (diffMs <= 0) return 'Expired';
	const totalSec = Math.floor(diffMs / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const mins = Math.floor(totalSec / 60);
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	return `${hours}h`;
}

function getExpiryDescription(mode: string): string {
	switch (mode) {
		case '5m':
			return 'Messages automatically self-destruct 5 minutes after being sent.';
		case '1h':
			return 'Messages automatically self-destruct 1 hour after being sent.';
		case '24h':
			return 'Messages automatically self-destruct 24 hours after being sent.';
		case 'session_only':
			return 'RAM-only session. All data is destroyed when this session or browser tab is closed.';
		default:
			return 'Messages persist in your device’s private encrypted database.';
	}
}

export const WhisperChatArea: React.FC<WhisperChatAreaProps> = ({ channel }) => {
	const {
		activeSession,
		sendMessage,
		sendFile,
		sendVoiceMessage,
		sendVideoMessage,
		burnSession,
		exitWhisperMode,
		openSafetyNumberModal,
		isConnecting,
	} = useWhisperStore();

	const currentUser = useAuthStore((state) => state.user);
	const theme = useAppStore((state) => state.theme);
	const isMobile = useMediaQuery('(max-width: 768px)');
	const liveChannel =
		useChannelStore((state) => state.channels.find((c) => c.id === channel.id)) ||
		channel;

	const [inputText, setInputText] = useState('');
	const [isSending, setIsSending] = useState(false);
	const [showEmoji, setShowEmoji] = useState(false);
	const [showVideoRecorder, setShowVideoRecorder] = useState(false);
	const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [, setTimerTick] = useState(0);

	const feedRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const otherMemberId =
		liveChannel.members.find((m) => m !== currentUser?.id) ||
		liveChannel.members[0] ||
		liveChannel.id;

	const otherStatus = liveChannel.member_statuses?.[otherMemberId] || 'offline';
	const dmSubtitle = otherStatus.charAt(0).toUpperCase() + otherStatus.slice(1);
	const displayName = getChannelDisplayName(liveChannel, currentUser?.id || '');

	// Countdown timer tick for expiring messages
	useEffect(() => {
		const interval = setInterval(() => {
			setTimerTick((t) => t + 1);
		}, 3000);
		return () => clearInterval(interval);
	}, []);

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		if (isAtBottom) {
			messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		}
	}, [activeSession?.messages?.length, isAtBottom]);

	const handleScroll = useCallback(() => {
		const el = feedRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		setIsAtBottom(distanceFromBottom < 120);
	}, []);

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		setIsAtBottom(true);
	};

	if (!activeSession) {
		return (
			<div className="whisper-mode flex flex-col items-center justify-center h-full w-full bg-background text-muted-foreground p-4">
				<Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
				<p className="text-sm">Initializing secure Whisper session...</p>
			</div>
		);
	}

	const isClosed = activeSession.status === 'closed' || activeSession.status === 'burned';

	const handleSend = async () => {
		const trimmed = inputText.trim();
		if ((!trimmed && queuedFiles.length === 0) || isSending || !activeSession.sessionKey || isClosed) {
			return;
		}

		setIsSending(true);
		try {
			if (queuedFiles.length > 0) {
				for (const file of queuedFiles) {
					await sendFile(file);
				}
				setQueuedFiles([]);
			}
			if (trimmed) {
				await sendMessage(trimmed);
				setInputText('');
				if (textareaRef.current) {
					textareaRef.current.style.height = 'auto';
				}
			}
		} finally {
			setIsSending(false);
		}
	};

	const handleDirectVoiceSend = useCallback(
		async (voiceFile: File, voiceDuration?: number) => {
			if (!activeSession?.sessionKey || isClosed) return;
			try {
				let waveform: number[] | undefined;
				try {
					const audioBuffer = await decodeAudioBlob(voiceFile);
					waveform = extractWaveformPeaks(audioBuffer, 32);
				} catch (e) {
					console.warn('Failed to extract waveform:', e);
				}
				await sendVoiceMessage(voiceFile, voiceDuration, waveform);
			} catch (err) {
				console.error('Failed to send whisper voice message:', err);
			}
		},
		[activeSession?.sessionKey, isClosed, sendVoiceMessage],
	);

	const handleDirectVideoSend = useCallback(
		async (videoFile: File) => {
			if (!activeSession?.sessionKey || isClosed) return;
			if (videoFile.size > 15 * 1024 * 1024) {
				alert('Whisper video message exceeds maximum size of 15MB');
				return;
			}
			try {
				await sendVideoMessage(videoFile);
			} catch (err) {
				console.error('Failed to send whisper video message:', err);
			}
		},
		[activeSession?.sessionKey, isClosed, sendVideoMessage],
	);

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInputText(e.target.value);
		const el = e.target;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const triggerUpload = (mode: 'media' | 'audio' | 'file') => {
		if (!fileInputRef.current) return;
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

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;
		setQueuedFiles((prev) => [...prev, ...Array.from(files)]);
		if (fileInputRef.current) fileInputRef.current.value = '';
	};

	const removeQueuedFile = (index: number) => {
		setQueuedFiles((prev) => prev.filter((_, i) => i !== index));
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const files = e.dataTransfer.files;
		if (!files || files.length === 0 || !activeSession.sessionKey || isClosed) return;
		setQueuedFiles((prev) => [...prev, ...Array.from(files)]);
	};

	const messages = activeSession.messages || [];

	return (
		<div
			onDragOver={(e) => {
				e.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={() => setIsDragging(false)}
			onDrop={handleDrop}
			className={`whisper-mode flex flex-col h-full w-full bg-background relative overflow-hidden overscroll-none select-text ${
				isDragging ? 'ring-2 ring-primary ring-inset' : ''
			}`}
		>
			<ChatBackgroundPattern />

			{/* Topbar: Identical structure to ChatTopbar */}
			<div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0 relative z-10 bg-background">
				<div className="flex items-center gap-2 min-w-0">
					{isMobile && (
						<button
							type="button"
							onClick={exitWhisperMode}
							className="p-1 -ml-2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform cursor-pointer"
							title="Exit Whisper"
						>
							<ChevronLeft size={26} />
						</button>
					)}
					<div className="flex items-center gap-3 min-w-0">
						<div className="relative shrink-0 pointer-events-none">
							<Avatar
								userId={otherMemberId}
								avatarId={liveChannel.member_avatars?.[otherMemberId]}
								size={40}
							/>
							<div
								className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2px] border-background z-10 ${
									otherStatus === 'online'
										? 'bg-green-500'
										: otherStatus === 'away'
											? 'bg-yellow-500'
											: otherStatus === 'dnd'
												? 'bg-red-500'
												: 'bg-gray-500'
								}`}
							/>
						</div>
						<div className="flex flex-col min-w-0 pointer-events-none">
							<div className="text-[15px] font-bold text-foreground leading-tight truncate">
								{displayName}
							</div>
							<div className="text-[12px] text-muted-foreground leading-tight mt-0.5">
								{dmSubtitle}
							</div>
						</div>
					</div>
				</div>

				{/* Topbar Actions: Clean icons and text, NO EMOJIS, NO persistent badges */}
				<div className="flex items-center gap-1.5 text-muted-foreground">
					{/* Verify Button */}
					{activeSession.sessionKey && (
						<button
							type="button"
							onClick={openSafetyNumberModal}
							className={`h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
								activeSession.verified
									? 'bg-foreground/15 text-foreground border-foreground/30 hover:bg-foreground/20'
									: 'hover:bg-secondary text-muted-foreground hover:text-foreground border-border/60'
							}`}
							title="Verify Safety Number"
						>
							{activeSession.verified ? (
								<ShieldCheck size={16} />
							) : (
								<Shield size={16} />
							)}
							<span>{activeSession.verified ? 'Verified' : 'Verify'}</span>
						</button>
					)}

					{/* Burn Session Button */}
					<button
						type="button"
						onClick={() => burnSession()}
						className="h-9 px-3 rounded-lg text-xs font-semibold text-destructive hover:bg-destructive/10 border border-destructive/20 transition-colors cursor-pointer flex items-center gap-1.5"
						title="Permanently wipe all messages and keys from this device"
					>
						<Flame size={16} />
						<span className="hidden sm:inline">Burn</span>
					</button>

					{/* Exit Whisper Button */}
					<button
						type="button"
						onClick={exitWhisperMode}
						className="h-9 px-3 rounded-lg text-xs font-semibold hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/60 transition-colors cursor-pointer flex items-center gap-1.5"
						title="Return to standard chat"
					>
						<X size={16} />
						<span>Exit</span>
					</button>
				</div>
			</div>

			{/* Message Feed: Identical layout to ChatMessageFeed / MessageItem */}
			<div className="flex-1 relative z-10 min-h-0">
				<div
					ref={feedRef}
					onScroll={handleScroll}
					className="absolute inset-0 overflow-y-auto overflow-x-hidden px-4 py-6"
					style={{
						WebkitOverflowScrolling: 'touch',
						overscrollBehaviorY: 'contain',
					}}
				>
					{/* Starting Message: replaces AI cards and persistent badges */}
					<div className="py-10 px-2 mb-6 border-b border-border/50">
						<div className="relative inline-block mb-3">
							<Avatar
								userId={otherMemberId}
								avatarId={liveChannel.member_avatars?.[otherMemberId]}
								size={72}
							/>
							<div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background shadow-xs">
								<Lock size={12} />
							</div>
						</div>
						<h1 className="text-2xl font-bold mb-1.5 text-foreground">
							{activeSession.peerUsername}
						</h1>
						<p className="text-muted-foreground text-sm max-w-lg leading-relaxed">
							This is the start of your end-to-end encrypted Whisper session with {activeSession.peerUsername}.
						</p>
						<p className="text-xs text-muted-foreground/80 mt-1.5 max-w-lg leading-relaxed">
							Messages and media are encrypted directly on your device. Zero server storage. {getExpiryDescription(activeSession.expiryMode)}
						</p>
					</div>

					{/* Session status banner if applicable */}
					{activeSession.statusMessage && (
						<div className="my-4 mx-auto max-w-md py-2 px-3.5 rounded-lg bg-secondary/80 border border-border text-xs text-muted-foreground flex items-center justify-center gap-2 text-center">
							{isConnecting ? (
								<Loader2 size={14} className="animate-spin text-primary shrink-0" />
							) : (
								<AlertCircle size={14} className="text-muted-foreground shrink-0" />
							)}
							<span>{activeSession.statusMessage}</span>
						</div>
					)}

					{/* Messages Stream */}
					{messages.map((msg, i) => {
						const prevMsg = messages[i - 1];
						const grouped = isGrouped(prevMsg, msg);
						const isMe = msg.senderId === currentUser?.id;
						const senderName = isMe
							? (currentUser?.username || 'You')
							: (liveChannel.member_names?.[msg.senderId] || activeSession.peerUsername || 'User');
						const expiryLabel = formatExpiryTime(msg.expiresAt);

						const dateLabel = formatDate(msg.sentAt);
						const prevDateLabel = prevMsg ? formatDate(prevMsg.sentAt) : '';
						const showDateDivider = dateLabel !== prevDateLabel;

						return (
							<React.Fragment key={msg.id}>
								{showDateDivider && (
									<div className="flex items-center justify-center my-6 relative select-none">
										<div className="absolute inset-0 flex items-center">
											<div className="w-full border-t border-border/50"></div>
										</div>
										<div className="relative flex justify-center items-center text-xs font-semibold text-muted-foreground bg-background px-3 py-0.5 rounded-full border border-border/50">
											{dateLabel}
										</div>
									</div>
								)}

								<div
									className={`group flex mb-0.5 -mx-4 px-4 py-0.5 transition-colors relative select-none cursor-default hover:bg-accent/30 ${
										!grouped ? (isMobile ? 'mt-2' : 'mt-4') : ''
									}`}
								>
									{/* Avatar / Timestamp Column */}
									<div
										className={`flex shrink-0 ${isMobile ? 'w-[40px]' : 'w-[55px]'} pt-1`}
									>
										{!grouped ? (
											<Avatar
												userId={msg.senderId}
												avatarId={liveChannel.member_avatars?.[msg.senderId]}
												size={isMobile ? 32 : 40}
											/>
										) : (
											<div
												className={`w-full text-center text-transparent group-hover:text-muted-foreground select-none shrink-0 ${
													isMobile ? 'text-[9px] whitespace-nowrap' : 'pt-1 text-[10px]'
												}`}
											>
												{formatTime(msg.sentAt)}
											</div>
										)}
									</div>

									{/* Message Content Column */}
									<div className="flex flex-col min-w-0 flex-1 relative">
										{!grouped && (
											<div
												className={`flex gap-2 flex-nowrap ${
													isMobile ? 'items-center mb-1' : 'items-baseline mb-0.5'
												}`}
											>
												<span
													className={`font-semibold text-foreground tracking-wide hover:underline cursor-pointer truncate ${
														isMobile ? 'text-sm font-medium' : 'text-[15px]'
													}`}
												>
													{senderName}
												</span>
												<span
													className={`text-muted-foreground shrink-0 flex items-center gap-1.5 ${
														isMobile ? 'text-[9px] whitespace-nowrap' : 'text-xs'
													}`}
												>
													<span>{formatTime(msg.sentAt)}</span>
													{expiryLabel && (
														<span
															className="flex items-center gap-0.5 text-primary/90 text-[11px]"
															title="Disappearing message countdown"
														>
															<Clock size={11} />
															<span>{expiryLabel}</span>
														</span>
													)}
												</span>
											</div>
										)}

										{/* Message Text */}
										{msg.text && (
											<div
												className="text-[15px] text-foreground/90 leading-[22px] whitespace-pre-wrap break-words flex-1 min-w-0 select-text"
												dir="auto"
											>
												{msg.text}
											</div>
										)}

										{/* File / Voice / Video Attachment */}
										{msg.file && (
											<div className="mt-1">
												{msg.file.type === 'voice' || (!msg.file.type && msg.file.mime.startsWith('audio/')) ? (
													<WhisperVoiceBubble file={msg.file} />
												) : msg.file.type === 'video' ? (
													<WhisperVideoBubble file={msg.file} />
												) : msg.file.mime.startsWith('image/') && msg.file.blobUrl ? (
													<div className="rounded-lg overflow-hidden max-w-sm max-h-72 border border-border/40 inline-block">
														<img
															src={msg.file.blobUrl}
															alt={msg.file.name}
															className="w-full h-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
															onClick={() => window.open(msg.file?.blobUrl, '_blank')}
														/>
													</div>
												) : (
													<div className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/60 border border-border/50 max-w-sm">
														<div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
															<FileText size={18} />
														</div>
														<div className="flex-1 min-w-0">
															<p className="text-xs font-semibold text-foreground truncate">
																{msg.file.name}
															</p>
															<p className="text-[10px] text-muted-foreground">
																{formatFileSize(msg.file.size)}
															</p>
														</div>
														{msg.file.blobUrl && (
															<a
																href={msg.file.blobUrl}
																download={msg.file.name}
																className="p-1.5 hover:text-foreground text-primary transition-colors cursor-pointer shrink-0"
																title="Download file"
															>
																<Download size={16} />
															</a>
														)}
													</div>
												)}
											</div>
										)}
									</div>
								</div>
							</React.Fragment>
						);
					})}
					<div ref={messagesEndRef} />
				</div>

				{/* Scroll to Bottom Button */}
				<button
					type="button"
					onClick={scrollToBottom}
					aria-label="Scroll to latest messages"
					className={`absolute bottom-4 right-4 z-20 w-9 h-9 rounded-full bg-secondary border border-border shadow-md flex items-center justify-center text-foreground transition-all duration-200 hover:bg-accent cursor-pointer ${
						isAtBottom ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100 scale-100'
					}`}
				>
					<ChevronDown size={18} />
				</button>
			</div>

			{/* Input Area: Matches ChatInputArea with dashed incognito border */}
			<div className="px-4 pb-4 pt-0 shrink-0 relative z-10">
				<div className="bg-secondary/70 rounded-xl flex flex-col relative focus-within:ring-0 transition-all overflow-hidden border border-dashed border-border/90 focus-within:border-foreground/50 text-flat">
					{/* Queued Files Preview */}
					{queuedFiles.length > 0 && (
						<div className="flex gap-3 p-3 overflow-x-auto border-b border-dashed border-border/80">
							{queuedFiles.map((f, idx) => (
								<div
									key={idx}
									className="relative w-24 h-24 bg-accent/30 rounded-md flex flex-col items-center justify-center p-2 group shrink-0"
								>
									<button
										type="button"
										onClick={() => removeQueuedFile(idx)}
										className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 shadow-lg z-20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
										title="Remove attachment"
									>
										<X size={14} />
									</button>

									{f.type.startsWith('image/') ? (
										<img
											src={URL.createObjectURL(f)}
											alt="preview"
											className="w-full h-full object-cover rounded"
										/>
									) : (
										<div className="flex flex-col items-center gap-1">
											<FileText size={28} className="text-muted-foreground" />
											<span className="text-[10px] text-muted-foreground truncate w-20 text-center">
												{f.name}
											</span>
										</div>
									)}
								</div>
							))}
						</div>
					)}

					<div className={`flex items-start ${isMobile ? 'px-2 py-2 gap-2' : 'px-4 py-2.5 gap-3'}`}>
						{/* Attachments Dropdown Button */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									disabled={isClosed || !activeSession.sessionKey}
									className="mt-0.5 text-muted-foreground hover:text-foreground transition focus:outline-none disabled:opacity-40 cursor-pointer"
									title="Add attachment"
								>
									<Plus
										className={`bg-muted-foreground/10 rounded-full p-1 ${
											isMobile ? 'w-5 h-5' : 'w-6 h-6'
										} hover:bg-muted-foreground/20`}
									/>
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="start"
								side="top"
								sideOffset={8}
								className="w-48 bg-popover/95 backdrop-blur-md border-border shadow-xl rounded-xl p-1"
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
							</DropdownMenuContent>
						</DropdownMenu>

						<input
							ref={fileInputRef}
							type="file"
							multiple
							onChange={handleFileSelect}
							className="hidden"
						/>

						{/* Textarea */}
						<textarea
							ref={textareaRef}
							data-chat-input
							className="flex-1 bg-transparent border-none outline-none text-foreground text-[15px] leading-6 resize-none min-h-[24px] max-h-[140px] placeholder-muted-foreground/60 py-0 shadow-none ring-0 focus:ring-0"
							placeholder={
								isClosed
									? 'Whisper session ended.'
									: `Message ${activeSession.peerUsername}`
							}
							value={inputText}
							disabled={isClosed || !activeSession.sessionKey}
							onChange={handleInput}
							onKeyDown={handleKeyDown}
							rows={1}
							dir="auto"
						/>

						{/* Input Actions: Voice, Video, Emoji & Send */}
						<div
							className={`flex items-center ${isMobile ? 'gap-1' : 'gap-1.5'} shrink-0`}
						>
							<VoiceRecorder
								channelId={channel.id}
								onFile={(file) => setQueuedFiles((prev) => [...prev, file])}
								onSendVoice={handleDirectVoiceSend}
								size={isMobile ? 18 : 22}
							/>

							<button
								type="button"
								disabled={isClosed || !activeSession.sessionKey}
								onClick={() => setShowVideoRecorder(true)}
								className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/80 disabled:hover:bg-transparent disabled:hover:text-muted-foreground rounded-full transition flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 group"
								title="Record Video Message"
								aria-label="Record Video Message"
							>
								<Video
									size={isMobile ? 18 : 22}
									className="group-hover:scale-110 group-disabled:scale-100 transition-transform"
								/>
							</button>

							<div className="relative flex items-center justify-center">
								<button
									type="button"
									disabled={isClosed || !activeSession.sessionKey}
									onClick={(e) => {
										e.stopPropagation();
										setShowEmoji((v) => !v);
									}}
									className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/80 disabled:hover:bg-transparent disabled:hover:text-muted-foreground rounded-full transition flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 group"
									title="Add emoji"
									aria-label="Add emoji"
								>
									<Smile
										size={isMobile ? 18 : 22}
										className="group-hover:scale-110 group-disabled:scale-100 transition-transform"
									/>
								</button>
							</div>

							<button
								type="button"
								onClick={handleSend}
								disabled={
									(!inputText.trim() && queuedFiles.length === 0) ||
									isClosed ||
									!activeSession.sessionKey ||
									isSending
								}
								className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/80 disabled:hover:bg-transparent disabled:hover:text-muted-foreground rounded-full transition flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 group"
								title="Send Whisper"
								aria-label="Send Whisper"
							>
								{isSending ? (
									<Loader2
										size={isMobile ? 18 : 22}
										className="animate-spin text-primary"
									/>
								) : (
									<SendHorizontal
										size={isMobile ? 18 : 22}
										className="group-hover:scale-110 group-disabled:scale-100 transition-transform"
									/>
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Emoji Picker Popover */}
				{showEmoji && (
					<div className="absolute bottom-[70px] right-6 z-50">
						<EmojiPicker
							onSelect={(emoji) => {
								setInputText((prev) => prev + emoji);
								setShowEmoji(false);
							}}
							onClickOutside={() => setShowEmoji(false)}
							theme={theme}
						/>
					</div>
				)}

				{/* Video Message Recorder Modal */}
				<VideoMessageRecorderModal
					open={showVideoRecorder}
					onClose={() => setShowVideoRecorder(false)}
					onSend={handleDirectVideoSend}
				/>
			</div>
		</div>
	);
};

WhisperChatArea.displayName = 'WhisperChatArea';
