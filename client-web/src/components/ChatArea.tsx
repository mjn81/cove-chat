import {
	Profiler,
	useEffect,
	useCallback,
	useState,
	useMemo,
	memo,
} from 'react';
import { logProfiler } from '@/utils/profiler';

import { useQueryClient } from '@tanstack/react-query';
import { useMessages } from '@/hooks/useMessages';
import type { Message, Channel } from '@/types/api';
import { onWS, decryptMessage, wsSendReadReceipt } from '@/ws';
import { useAuthStore, useCryptoStore, useWhisperStore } from '@/store/store';
import { db } from '@/lib/db';
import { resolveOldestPending } from '@/utils/pendingMessages';
import { isDirectMessage } from '@/utils/channel';

import { Lock } from 'lucide-react';
import { ChatTopbar } from './Chat/ChatTopbar';
import { ChatMessageFeed } from './Chat/ChatMessageFeed';
import { ChatInputArea } from './Chat/ChatInputArea';
import { VoicePlayer } from './Chat/VoicePlayer';
import { ForwardModal } from './Chat/ForwardModal';
import { ChatBackgroundPattern } from './Chat/ChatBackgroundPattern';
import { WhisperChatArea } from './Chat/WhisperChatArea';

interface ChatAreaProps {
	channel: Channel;
}

interface DecryptedMessage extends Message {
	text?: string;
}

const ChatArea = memo(({ channel }: ChatAreaProps) => {
	const user = useAuthStore((state) => state.user);
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState('');

	const isWhisperModeActive = useWhisperStore((state) => state.isWhisperModeActive);
	const whisperPeerId = useWhisperStore((state) => state.whisperPeerId);
	const incomingInvite = useWhisperStore((state) => state.incomingInvite);
	const acceptInvite = useWhisperStore((state) => state.acceptInvite);
	const rejectInvite = useWhisperStore((state) => state.rejectInvite);
	const isConnecting = useWhisperStore((state) => state.isConnecting);

	const isDM = isDirectMessage(channel);
	const otherMemberId = isDM
		? channel.members?.find((m) => m !== user?.id) || channel.members?.[0]
		: undefined;
	const isWhisperActive = isDM && isWhisperModeActive && Boolean(otherMemberId && whisperPeerId === otherMemberId);
	const hasIncomingInviteForPeer = Boolean(isDM && incomingInvite && otherMemberId && incomingInvite.initiatorId === otherMemberId);


	const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useMessages(channel.id);

	const messages = useMemo(() => {
		if (!data) return [];
		return data.pages.flat();
	}, [data]);

	// Send read receipt when opening channel
	useEffect(() => {
		wsSendReadReceipt(channel.id);
	}, [channel.id]);


	const filteredMessages = useMemo(
		() =>
			searchQuery
				? messages.filter((m) =>
						m.text?.toLowerCase().includes(searchQuery.toLowerCase()),
					)
				: messages,
		[messages, searchQuery],
	);

	// Pre-populate query data from IndexedDB when channel changes
	useEffect(() => {
		const preloadFromDB = async () => {
			const cached = await db.getCachedMessages(channel.id);
			if (cached.length > 0) {
				queryClient.setQueryData(['messages', channel.id], (old: any) => {
					// Only set if we don't have fresh data yet
					if (old && old.pages && old.pages.length > 0) return old;
					const newestFirst = [...cached].reverse();
					return {
						pages: [newestFirst],
						pageParams: [undefined]
					};
				});
			}
		};
		preloadFromDB();
	}, [channel.id, queryClient]);

	// Decrypt and set a message via cache
	const addMessage = useCallback(
		async (msg: Message) => {
			// Avoid duplicates if we just fetched from REST
			const text = msg.type === 'text' ? await decryptMessage(msg) : undefined;
			const fullMsg = { ...msg, text };

			// Save to IndexedDB
			await db.cacheMessages([fullMsg]);

			queryClient.setQueryData(
				['messages', channel.id],
				(old: any) => {
					if (!old || !old.pages) return { pages: [[fullMsg]], pageParams: [undefined] };
					for (const page of old.pages) {
						if (page.some((m: any) => m.id === msg.id)) return old;
					}
					const newPages = [...old.pages];
					newPages[0] = [fullMsg, ...newPages[0]];
					return { ...old, pages: newPages };
				},
			);
		},
		[queryClient, channel.id],
	);

	// Subscribe to incoming messages for this channel
	useEffect(() => {
		const unsubMsg = onWS('message', (payload) => {
			const msg = payload as Message;
			if (msg.channel_id === channel.id) {
				if (msg.sender_id === user?.id) {
					resolveOldestPending(queryClient, channel.id);
				}
				addMessage(msg);
			}
		});

		const unsubUpdate = onWS('message_update', async (payload) => {
			const msg = payload as Message;
			if (msg.channel_id === channel.id) {
				const text =
					msg.type === 'text' ? await decryptMessage(msg) : undefined;
				const fullMsg = { ...msg, text };

				await db.cacheMessages([fullMsg]);

				queryClient.setQueryData(
					['messages', channel.id],
					(old: any) => {
						if (!old || !old.pages) return { pages: [[fullMsg]], pageParams: [undefined] };
						return {
							...old,
							pages: old.pages.map((page: any) => page.map((m: any) => (m.id === msg.id ? fullMsg : m)))
						};
					},
				);
			}
		});

		const unsubDelete = onWS('message_delete', (payload: any) => {
			const { channel_id, message_id } = payload;
			if (channel_id === channel.id) {
				db.deleteMessage(message_id);
				queryClient.setQueryData(
					['messages', channel.id],
					(old: any) => {
						if (!old || !old.pages) return { pages: [], pageParams: [] };
						return {
							...old,
							pages: old.pages.map((page: any) => page.filter((m: any) => m.id !== message_id))
						};
					},
				);
			}
		});

		return () => {
			unsubMsg();
			unsubUpdate();
			unsubDelete();
		};
	}, [channel.id, addMessage, queryClient, user?.id]);

	// Invalidate messages if the channel key arrives late
	useEffect(() => {
		return onWS('channel_key', (payload: any) => {
			if (payload.channel_id === channel.id) {
				queryClient.invalidateQueries({ queryKey: ['messages', channel.id] });
			}
		});
	}, [channel.id, queryClient]);

	const channelKey = useCryptoStore((state) =>
		state.channelKeys.get(channel.id),
	);
	const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
	const [forwardMessage, setForwardMessage] = useState<DecryptedMessage | null>(null);

	const handleReply = useCallback((msg: DecryptedMessage) => {
		setReplyTo(msg);
	}, []);

	const handleForward = useCallback((msg: DecryptedMessage) => {
		setForwardMessage(msg);
	}, []);

	if (isWhisperActive) {
		return (
			<Profiler id="ChatArea" onRender={logProfiler}>
				<WhisperChatArea channel={channel} />
			</Profiler>
		);
	}

	return (
		<Profiler id="ChatArea" onRender={logProfiler}>
			<div className="flex flex-col h-full w-full bg-background relative overflow-hidden overscroll-none">
				<ChatBackgroundPattern />
				<ChatTopbar
					channel={channel}
					currentUserId={user?.id ?? ''}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
				/>
				{hasIncomingInviteForPeer && incomingInvite && (
					<div className="bg-secondary/40 border-b border-border px-4 py-2.5 flex items-center justify-between gap-3 text-xs z-10 animate-in fade-in slide-in-from-top-2 duration-150">
						<div className="flex items-center gap-2.5 min-w-0">
							<Lock className="w-4 h-4 text-muted-foreground shrink-0" />
							<span className="text-muted-foreground truncate">
								<strong className="text-foreground font-medium">{incomingInvite.initiatorUsername}</strong> invited you to a Whisper chat
							</span>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<button
								type="button"
								onClick={() => acceptInvite(incomingInvite)}
								disabled={isConnecting}
								className="px-3.5 py-1 bg-foreground text-background font-medium rounded-lg hover:opacity-90 active:scale-98 transition text-xs cursor-pointer shadow-xs disabled:opacity-50"
							>
								{isConnecting ? 'Connecting...' : 'Accept'}
							</button>
							<button
								type="button"
								onClick={() => rejectInvite(incomingInvite.sessionId)}
								disabled={isConnecting}
								className="px-3.5 py-1 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-medium rounded-lg active:scale-98 transition text-xs cursor-pointer disabled:opacity-50"
							>
								Decline
							</button>
						</div>
					</div>
				)}
				<VoicePlayer />
				<ChatMessageFeed
					messages={filteredMessages}
					channel={channel}
					onReply={handleReply}
					onForward={handleForward}
					fetchNextPage={fetchNextPage}
					hasNextPage={hasNextPage}
					isFetchingNextPage={isFetchingNextPage}
				/>

				<ChatInputArea
					channel={channel}
					channelKey={channelKey ?? new Uint8Array(32)} // Fallback in case key isn't loaded
					replyTo={replyTo}
					onCancelReply={() => setReplyTo(null)}
					messages={messages}
				/>

				{forwardMessage && (
					<ForwardModal 
						message={forwardMessage} 
						onClose={() => setForwardMessage(null)} 
					/>
				)}
			</div>
		</Profiler>
	);
});

ChatArea.whyDidYouRender = true;
export default ChatArea;
