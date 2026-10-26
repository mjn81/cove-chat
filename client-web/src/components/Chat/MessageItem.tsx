import { useState, useRef, useMemo, memo, useEffect, useCallback } from 'react';

import { useAuthStore } from '@/store/store';
import { Avatar } from '../Avatar';
import { type Message, type Channel } from '@/types/api';
import { FileBubble } from './FileBubble';
import { VideoMessageBubble } from './VideoMessageBubble';
import { Reply, Pencil, Trash2, CornerUpLeft, Loader2, AlertCircle } from 'lucide-react';
import { wsEditMessage, wsDeleteMessage } from '@/ws';
import { JoinPreview } from './JoinPreview';
import { ConfirmModal } from '../ConfirmModal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { tokenizeMessage } from '@/utils/linkify';

interface MessageItemProps {
	msg: Message & { text?: string };
	channel: Channel;
	grouped: boolean;
	formatTime: (iso: string) => string;
	onReply?: (msg: Message & { text?: string }) => void;
	onForward?: (msg: Message & { text?: string }) => void;
	replyTarget?: Message & { text?: string };
}

export const MessageItem = memo(
	({
		msg,
		channel,
		grouped,
		formatTime,
		onReply,
		onForward,
		replyTarget,
	}: MessageItemProps) => {
		const user = useAuthStore((state) => state.user);
		const [isEditing, setIsEditing] = useState(false);
		const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
		const [editValue, setEditValue] = useState(msg.text || '');
		const [showMobileMenu, setShowMobileMenu] = useState(false);
		const [dragX, setDragX] = useState(0);
		const isOwn = user?.id === msg.sender_id;

		const isMobile = useMediaQuery('(max-width: 768px)');
		const dragStartX = useRef<number | null>(null);
		const isDragging = useRef(false);
		const textareaRef = useRef<HTMLTextAreaElement>(null);

		// Sync editValue whenever the decrypted text is updated externally
		// (e.g. another edit arrives, or the message is first decrypted).
		// Guard with isEditing so we don't clobber live user input.
		useEffect(() => {
			if (!isEditing) {
				setEditValue(msg.text || '');
			}
		}, [msg.text, isEditing]);

		// Auto-resize the textarea whenever its content or visibility changes.
		useEffect(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight}px`;
		}, [editValue, isEditing]);

		const handleDragStart = (x: number) => {
			dragStartX.current = x;
			isDragging.current = true;
		};

		const handleDragMove = (x: number) => {
			if (dragStartX.current === null) return;
			const delta = x - dragStartX.current;
			// Allow dragging both ways (negative for reply, positive for forward)
			const clamped = Math.max(delta, -120);
			// For now, resistance for positive delta to show it's possible but fix the scrollbar
			setDragX(Math.min(clamped, 120));
		};

		const handleDragEnd = () => {
			if (dragX < -80) {
				onReply?.(msg);
			} else if (dragX > 80) {
				onForward?.(msg);
			}
			setDragX(0);
			dragStartX.current = null;
			isDragging.current = false;
		};

		useEffect(() => {
			const handler = (e: any) => {
				if (e.detail.messageId === msg.id) {
					setIsEditing(true);
					setEditValue(msg.text || '');
				}
			};
			window.addEventListener('edit-message', handler);
			return () => window.removeEventListener('edit-message', handler);
		}, [msg.id, msg.text]);

		const joinCode = useMemo(() => {
			if (!msg.text) return null;
			// Match /join/ followed by alphanumeric/dashes
			const match = msg.text.match(/\/join\/([a-zA-Z0-9-]+)/);
			return match ? match[1] : null;
		}, [msg.text]);

		const isMentioned = useMemo(() => {
			if (!user || !msg.text) return false;
			// Simple check for @username. In a real app we might use regex for boundaries.
			return msg.text.includes(`@${user.username}`);
		}, [user, msg.text]);

		// Return focus to the main chat input after exiting edit mode.
		const focusChatInput = useCallback(() => {
			const chatInput = document.querySelector<HTMLElement>('[data-chat-input]');
			chatInput?.focus();
		}, []);

		const cancelEditing = useCallback(() => {
			setIsEditing(false);
			focusChatInput();
		}, [focusChatInput]);

		const handleEdit = async () => {
			if (!editValue.trim() || editValue === msg.text) {
				cancelEditing();
				return;
			}
			const ok = await wsEditMessage(channel.id, msg.id, editValue);
			if (ok) {
				setIsEditing(false);
				focusChatInput();
			}
		};

		const handleDelete = async () => {
			wsDeleteMessage(channel.id, msg.id);
		};

		const renderText = (text: string) => {
			if (!text) return text;
			return tokenizeMessage(text).map((token, i) => {
				if (token.type === 'mention') {
					const isMe = user?.username === token.value.substring(1);
					return (
						<span
							key={i}
							className={`rounded-[3px] px-[2px] font-medium transition-colors cursor-pointer ${
								isMe
									? 'bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground'
									: 'text-primary hover:underline'
							}`}
						>
							{token.value}
						</span>
					);
				}
				if (token.type === 'url' || token.type === 'email') {
					// noopener/noreferrer: the target page must not reach window.opener or learn which chat linked it.
					return (
						<a
							key={i}
							href={token.href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline break-all"
						>
							{token.value}
						</a>
					);
				}
				return token.value;
			});
		};

		return (
			<div
				onMouseDown={(e) => handleDragStart(e.clientX)}
				onMouseMove={(e) => handleDragMove(e.clientX)}
				onMouseUp={handleDragEnd}
				onMouseLeave={handleDragEnd}
				onTouchStart={(e) => handleDragStart(e.touches[0].clientX)}
				onTouchMove={(e) => handleDragMove(e.touches[0].clientX)}
				onTouchEnd={handleDragEnd}
				onClick={() => isMobile && setShowMobileMenu(!showMobileMenu)}
				className={`group flex mb-0.5 -mx-4 px-4 py-0.5 transition-colors relative select-none cursor-default ${
					!grouped ? (isMobile ? 'mt-2' : 'mt-4') : ''
				} ${
					isMentioned
						? 'bg-mention border-s-2 border-mention-border hover:opacity-90'
						: showMobileMenu && isMobile
							? 'bg-primary/5 border-s-2 border-primary/30'
							: 'hover:bg-accent/30 border-s-2 border-transparent'
				}`}
				style={{ touchAction: 'pan-y' }}
			>
				{/* Dedicated clipping container for swipe indicators */}
				<div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
					{/* Swipe to Reply Indicator (revealed when sliding LEFT) */}
					<div 
						className="absolute end-0 top-0 bottom-0 flex items-center justify-center transition-all"
						style={{ 
							width: '80px',
							opacity: dragX < 0 ? Math.min(Math.abs(dragX) / 60, 1) : 0,
							transform: `translateX(${80 + dragX}px) scale(${dragX < 0 ? Math.min(Math.abs(dragX) / 60, 1.2) : 1})`
						}}
					>
						<div className="bg-primary/10 p-2 rounded-full border border-primary/20">
							<Reply size={20} className="text-primary" />
						</div>
					</div>
	
					{/* Swipe to Forward Indicator (revealed when sliding RIGHT) */}
					<div 
						className="absolute start-0 top-0 bottom-0 flex items-center justify-center transition-all"
						style={{ 
							width: '80px',
							opacity: dragX > 0 ? Math.min(dragX / 60, 1) : 0,
							transform: `translateX(${-80 + dragX}px) scale(${dragX > 0 ? Math.min(dragX / 60, 1.2) : 1})`
						}}
					>
						<div className="bg-primary/10 p-2 rounded-full border border-primary/20">
							<CornerUpLeft size={20} className="text-primary rotate-180" />
						</div>
					</div>
				</div>

				<div 
					className="flex flex-1 min-w-0 transition-transform duration-75 ease-out relative z-10"
					style={{ transform: `translateX(${dragX}px)` }}
				>
					{/* Action Menu */}
					{!isEditing && !msg.pending && (
						<div
							className={`absolute end-4 -top-3 items-center gap-0.5 bg-background border border-border rounded-md shadow-lg overflow-hidden z-20 ${
								showMobileMenu && isMobile
									? 'flex animate-in zoom-in-95 duration-150'
									: 'hidden group-hover:flex'
							}`}
							style={{ transform: `translateX(${-dragX}px)` }} // Counter-translate to keep it visible
						>
						<button
							onClick={(e) => {
								e.stopPropagation();
								onReply?.(msg);
								if (isMobile) setShowMobileMenu(false);
							}}
							className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
							title="Reply"
						>
							<Reply size={14} />
						</button>
						{isOwn && msg.type === 'text' && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									setEditValue(msg.text || '');
									setIsEditing(true);
									if (isMobile) setShowMobileMenu(false);
								}}
								className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors border-s border-border"
								title="Edit Message"
							>
								<Pencil size={14} />
							</button>
						)}
						{isOwn && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									setShowDeleteConfirm(true);
									if (isMobile) setShowMobileMenu(false);
								}}
								className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors border-s border-border"
								title="Delete Message"
							>
								<Trash2 size={14} />
							</button>
						)}
					</div>
				)}

				<ConfirmModal
					isOpen={showDeleteConfirm}
					onClose={() => setShowDeleteConfirm(false)}
					onConfirm={handleDelete}
					title="Delete Message"
					message="Are you sure you want to delete this message? This action cannot be undone."
					confirmText="Delete"
					variant="danger"
				/>

				<div
					className={`flex shrink-0 ${isMobile ? 'w-[40px]' : 'w-[55px]'} pt-1`}
				>
					{!grouped ? (
						<Avatar
							userId={msg.sender_id}
							avatarId={channel.member_avatars?.[msg.sender_id]}
							size={isMobile ? 32 : 40}
						/>
					) : (
						<div
							className={`w-full text-center text-transparent group-hover:text-muted-foreground select-none shrink-0 ${isMobile ? 'text-[9px] whitespace-nowrap' : 'pt-1 text-[10px]'}`}
						>
							{formatTime(msg.sent_at)}
						</div>
					)}
				</div>
				<div
					className={`flex flex-col min-w-0 flex-1 relative ${isMobile ? 'gap-0.5' : ''}`}
				>
					{msg.reply_to_id && (
						<div className="flex items-center gap-1 mb-1 h-5 select-none relative group/reply-target">
							<CornerUpLeft
								size={14}
								className={`text-muted-foreground/40 shrink-0 ${isMobile ? 'ms-[-13px]' : 'ms-[-17px]'}`}
							/>

							<div className="flex items-center gap-1.5 min-w-0 opacity-70 hover:opacity-100 transition-opacity">
								<Avatar
									userId={replyTarget?.sender_id || ''}
									avatarId={
										replyTarget
											? channel.member_avatars?.[replyTarget.sender_id]
											: undefined
									}
									size={14}
								/>
								<span className="font-bold text-[13px] text-muted-foreground hover:text-foreground cursor-pointer truncate max-w-[120px]">
									{replyTarget
										? channel.member_names?.[replyTarget.sender_id] ||
											replyTarget.sender_id
										: 'Unknown User'}
								</span>
								<span className="text-[13px] truncate text-muted-foreground/80 hover:text-foreground cursor-pointer italic max-w-[60%]">
									{replyTarget
										? replyTarget.type === 'text'
											? replyTarget.text
											: `[${replyTarget.type}]`
										: 'Original message not found'}
								</span>
							</div>
						</div>
					)}
					{!grouped && (
						<div
							className={`flex gap-2 flex-nowrap ${isMobile ? 'items-center mb-1' : 'items-baseline mb-0.5'}`}
						>
							<span
								className={`font-semibold text-foreground tracking-wide hover:underline cursor-pointer truncate ${isMobile ? 'text-sm font-medium' : 'text-[15px]'}`}
							>
								{channel.member_names?.[msg.sender_id] || msg.sender_id}
							</span>
							<span
								className={`text-muted-foreground shrink-0 ${isMobile ? 'text-[9px] whitespace-nowrap' : 'text-xs'}`}
							>
								{formatTime(msg.sent_at)}
							</span>
						</div>
					)}
					{msg.type === 'text' && (
						<>
							{isEditing ? (
								<div className="mt-1">
									<div className="bg-secondary rounded-lg px-3 py-2 border border-primary/30">
										<textarea
											ref={textareaRef}
											autoFocus
											value={editValue}
											onChange={(e) => setEditValue(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === 'Enter' && !e.shiftKey) {
													e.preventDefault();
													handleEdit();
												} else if (e.key === 'Escape') {
													cancelEditing();
												}
											}}
											className="w-full bg-transparent border-none outline-none text-[15px] resize-none overflow-hidden"
											rows={1}
										/>
									</div>
									<div className="flex gap-2 mt-1.5 text-[11px]">
										<span className="text-muted-foreground">
											escape to{' '}
											<span
												className="text-primary hover:underline cursor-pointer"
												onClick={cancelEditing}
											>
												cancel
											</span>
										</span>
										<span className="text-muted-foreground">•</span>
										<span className="text-muted-foreground">
											enter to{' '}
											<span
												className="text-primary hover:underline cursor-pointer"
												onClick={handleEdit}
											>
												save
											</span>
										</span>
									</div>
								</div>
							) : (
								<div
									className={`text-[15px] text-foreground/90 leading-[22px] whitespace-pre-wrap break-words flex-1 min-w-0 ${msg.pending ? 'opacity-60' : ''}`}
									dir="auto"
								>
									{msg.text ? renderText(msg.text) : '[encrypted]'}
									{msg.edited_at && (
										<span className="text-[10px] text-muted-foreground ms-1 inline-block select-none">
											(edited)
										</span>
									)}
								</div>
							)}
							{msg.pending === 'sending' && (
								<div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
									<Loader2 size={10} className="animate-spin" />
									<span>Sending…</span>
								</div>
							)}
							{msg.pending === 'failed' && (
								<div className="flex items-center gap-1.5 text-[10px] text-destructive mt-0.5">
									<AlertCircle size={10} />
									<span>Failed to send</span>
									<button
										type="button"
										onClick={() => (msg as any)._retry?.()}
										className="underline hover:no-underline font-semibold"
									>
										Retry
									</button>
								</div>
							)}
							{joinCode && !isEditing && <JoinPreview inviteCode={joinCode} />}
						</>
					)}
					{(msg.type === 'file' || msg.type === 'voice') && (
						<FileBubble msg={msg} />
					)}
					{msg.type === 'video' && (
						<VideoMessageBubble msg={msg} />
					)}
				</div>
			</div>
		</div>
	);
});

MessageItem.displayName = 'MessageItem';

