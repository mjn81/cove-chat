import { useTranslation } from 'react-i18next';
import { formatClockTime, formatDayLabel } from '@/utils/datetime';
import { useRef, useMemo, memo, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import { type Message, type Channel } from '@/types/api';
import { MessageItem } from './MessageItem';
import { Avatar } from '../Avatar';
import { isDirectMessage } from '@/utils/channel';
import { getChannelDisplayName, useAuthStore } from '@/store/store';

// In flex-col-reverse, scrollTop is 0 exactly at the bottom (newest message).
const AT_BOTTOM_THRESHOLD = 100;

interface ChatMessageFeedProps {
	messages: (Message & { text?: string })[];
	channel: Channel;
	onReply?: (msg: Message & { text?: string }) => void;
	onForward?: (msg: Message & { text?: string }) => void;
	fetchNextPage?: () => void;
	hasNextPage?: boolean;
	isFetchingNextPage?: boolean;
}

// Group consecutive messages from the same sender
function isGrouped(
	prev: (Message & { text?: string }) | undefined,
	curr: Message & { text?: string },
): boolean {
	if (!prev) return false;
	// Replies never get grouped for better UI
	if (curr.reply_to_id) return false;
	return (
		prev.sender_id === curr.sender_id &&
		Math.abs(new Date(curr.sent_at).getTime() - new Date(prev.sent_at).getTime()) <
			300_000 // 5 minutes
	);
}

export const ChatMessageFeed = memo(
	({
		messages,
		channel,
		onReply,
		onForward,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	}: ChatMessageFeedProps) => {
		const { t } = useTranslation();
		const feedRef = useRef<HTMLDivElement>(null);
		const dayLabels = useMemo(
			() => ({ today: t('chat.today'), yesterday: t('chat.yesterday') }),
			[t],
		);

		const renderedItems = useMemo(() => {
			const items: Array<
				| { type: 'date'; label: string; id: string }
				| { type: 'header'; id: string }
				| {
						type: 'msg';
						msg: Message & { text?: string };
						grouped: boolean;
						id: string;
				  }
			> = [];

			// messages is newest-first. Index 0 is newest.
			messages.forEach((msg, i) => {
				const olderMsg = messages[i + 1];
				const grouped = isGrouped(olderMsg, msg);
				items.push({ type: 'msg', msg, grouped, id: msg.id });

				const dateLabel = formatDayLabel(msg.sent_at, dayLabels);
				const nextMsg = messages[i + 1]; // next in array = older in time
				const nextDateLabel = nextMsg ? formatDayLabel(nextMsg.sent_at, dayLabels) : '';

				if (dateLabel !== nextDateLabel) {
					items.push({
						type: 'date',
						label: dateLabel,
						id: `date-${dateLabel}`,
					});
				}
			});

			// If no more history, add a welcome header at the end of history (top of feed)
			if (!hasNextPage && items.length > 0) {
				items.push({
					type: 'header',
					id: 'welcome-header'
				});
			}

			return items;
		}, [messages, hasNextPage, dayLabels]);

		const user = useAuthStore((state) => state.user);
		const isDM = isDirectMessage(channel);
		const displayName = getChannelDisplayName(channel, user?.id || '');

		const [isAtBottom, setIsAtBottom] = useState(true);

		const scrollToBottom = useCallback(() => {
			feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
		}, []);

		const virtualizer = useVirtualizer({
			count: renderedItems.length,
			getScrollElement: () => feedRef.current,
			estimateSize: () => 80,
			getItemKey: (index) => renderedItems[index]?.id || `item-${index}`,
			overscan: 40,
			observeElementOffset: (instance, cb) => {
				const element = instance.scrollElement;
				if (!element) return;

				const handler = (isScrolling: boolean) => {
					// In flex-col-reverse, scrollTop is 0 at bottom and negative towards top.
					// We want the absolute distance from the bottom.
					const distance = Math.abs(element.scrollTop);
					cb(distance, isScrolling);
					setIsAtBottom(distance < AT_BOTTOM_THRESHOLD);
				};

				const onScroll = () => handler(true);
				element.addEventListener('scroll', onScroll, { passive: true });
				handler(false);
				return () => element.removeEventListener('scroll', onScroll);
			},
		});

		const virtualItems = virtualizer.getVirtualItems();
		const totalSize = virtualizer.getTotalSize();

		// Load more when reaching the top (end of our newest-first array)
		const loaderRef = useRef<HTMLDivElement>(null);
		useEffect(() => {
			if (!hasNextPage || isFetchingNextPage || !loaderRef.current) return;

			const observer = new IntersectionObserver(
				(entries) => {
					if (entries[0].isIntersecting) {
						fetchNextPage?.();
					}
				},
				{ threshold: 0.1, rootMargin: '400px' },
			);

			observer.observe(loaderRef.current);
			return () => observer.disconnect();
		}, [hasNextPage, isFetchingNextPage, fetchNextPage, renderedItems.length]);

		const startSpacerHeight = virtualItems[0]?.start || 0;
		const endSpacerHeight = totalSize - (virtualItems[virtualItems.length - 1]?.end || 0);

		return (
			<div className="flex-1 relative z-10 min-h-0">
			<div
				className="absolute inset-0 overflow-y-auto overflow-x-hidden px-4 py-6 flex flex-col-reverse"
				ref={feedRef}
				id="messages-feed"
				style={{
					overflowAnchor: 'none',
					willChange: 'scroll-position',
					overscrollBehaviorY: 'contain',
					WebkitTransform: 'translateZ(0)',
					WebkitOverflowScrolling: 'touch'
				}}
			>
				{/* 1. Bottom Spacer (visually newest items) */}
				<div 
					style={{ 
						height: `${startSpacerHeight}px`,
						flexShrink: 0,
						overflowAnchor: 'none'
					}} 
				/>

				{/* 2. Visible Items */}
				{virtualItems.map((virtualRow) => {
					const item = renderedItems[virtualRow.index];
					if (!item) return null;

					if (item.type === 'header') {
						const otherId = isDM ? channel.members.find(m => m !== user?.id) || channel.id : '';
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="py-12 px-4 mb-8 border-b border-border/50"
							>
								{isDM ? (
									<div className="mb-4">
										<Avatar 
											userId={otherId} 
											avatarId={channel.member_avatars?.[otherId]} 
											size={80} 
										/>
									</div>
								) : (
									<div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
										<span className="text-3xl text-primary font-bold">#</span>
									</div>
								)}
								<h1 className="text-3xl font-bold mb-2">
									{isDM ? displayName : `Welcome to #${displayName}!`}
								</h1>
								<p className="text-muted-foreground">
									{isDM 
										? `This is the beginning of your direct message history with ${displayName}.`
										: `This is the start of the #${displayName} channel.`
									}
								</p>
							</div>
						);
					}

					return (
						<div
							key={virtualRow.key}
							data-index={virtualRow.index}
							ref={virtualizer.measureElement}
							className="w-full shrink-0"
						>
							{item.type === 'date' ? (
								<div className="flex items-center justify-center my-6 relative select-none">
									<div className="absolute inset-0 flex items-center">
										<div className="w-full border-t border-border/50"></div>
									</div>
									<div className="relative flex justify-center items-center text-xs font-semibold text-muted-foreground bg-background px-3 py-0.5 rounded-full border border-border/50">
										{item.label}
									</div>
								</div>
							) : (
								<MessageItem
									msg={item.msg}
									channel={channel}
									grouped={item.grouped}
									formatTime={formatClockTime}
									onReply={onReply}
									onForward={onForward}
									replyTarget={
										item.msg.reply_to_id
											? messages.find((m) => m.id === item.msg.reply_to_id)
											: undefined
									}
								/>
							)}
						</div>
					);
				})}

				{/* 3. Top Spacer (visually older items) */}
				<div 
					style={{ 
						height: `${endSpacerHeight}px`,
						flexShrink: 0,
						overflowAnchor: 'none'
					}} 
				/>

				{/* 4. Loader (visually at the very top) */}
				<div
					ref={loaderRef}
					className="flex justify-center py-4 h-[60px] items-center shrink-0"
					style={{ 
						display: hasNextPage ? 'flex' : 'none',
						overflowAnchor: 'none' 
					}}
				>
					{hasNextPage && <span className="spinner small" />}
				</div>
			</div>

			<button
				type="button"
				onClick={scrollToBottom}
				aria-label="Scroll to latest messages"
				className={`absolute bottom-4 end-4 z-20 w-9 h-9 rounded-full bg-secondary border border-border shadow-md flex items-center justify-center text-foreground transition-all duration-200 hover:bg-accent ${
					isAtBottom
						? 'opacity-0 scale-90 pointer-events-none'
						: 'opacity-100 scale-100'
				}`}
			>
				<ChevronDown size={18} />
			</button>
			</div>
		);
	},
);

ChatMessageFeed.displayName = 'ChatMessageFeed';
export default ChatMessageFeed;
