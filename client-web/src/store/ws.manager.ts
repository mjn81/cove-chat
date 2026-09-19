// ws.manager.ts
import { wsConnect, wsDisconnect, onWS, wsSendReadReceipt, decryptMessage } from '@/ws';
import { useChannelStore, useAuthStore, getChannelDisplayName } from './store';
import { playNotificationSound, showBrowserNotification } from '@/utils/notifications';
import type { Message } from '@/types/api';
import { useAppStore } from './app.slice';
import { useVoiceStore } from './voiceStore';
import { buildMessagePreview } from '@/utils/messagePreview';

let initialized = false;
let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedRefresh() {
	if (refreshTimeout) clearTimeout(refreshTimeout);
	refreshTimeout = setTimeout(() => {
		useChannelStore.getState().refreshChannels();
	}, 100);
}

let connectTime = 0;

// Re-attempts every locally "failed" message across all loaded channels once
// the socket comes back up — without this, a message that failed to send
// while offline just sits there forever needing a manual tap, which is what
// broke the "server is down" story from feeling recoverable.
function retryFailedMessages() {
	const queryClient = (window as any).queryClient;
	if (!queryClient) return;
	const queries = queryClient.getQueryCache().findAll({ queryKey: ['messages'] });
	for (const query of queries) {
		const data: any = query.state.data;
		if (!data?.pages) continue;
		for (const page of data.pages) {
			for (const msg of page) {
				if (msg.pending === 'failed' && typeof msg._retry === 'function') {
					msg._retry();
				}
			}
		}
	}
}

export function initWebSocket() {
	if (initialized) return;
	initialized = true;

	onWS('open', () => {
		useAppStore.getState().setWsState('connected');
		retryFailedMessages();
	});

	onWS('close', () => {
		useAppStore.getState().setWsState('disconnected');
	});

	// The socket already reconnects on its own with backoff, but that backoff
	// timer can be heavily throttled in a backgrounded tab. Short-circuit it
	// as soon as the network or tab becomes active again, so the user doesn't
	// come back to a connection that's still slowly retrying (or refresh out
	// of the mistaken belief it never reconnects at all).
	if (typeof window !== 'undefined') {
		const reconnectIfNeeded = () => {
			if (useAppStore.getState().wsState !== 'connected') {
				connectWS();
			}
		};
		window.addEventListener('online', reconnectIfNeeded);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') reconnectIfNeeded();
		});

		// Telegram-style polling safety-net: the backoff timer and the
		// online/visibilitychange listeners above cover the common cases,
		// but some environments never fire a clean close/error event (or
		// fire 'online' unreliably) — poll periodically as a last resort so
		// a dropped connection can never go unnoticed indefinitely.
		setInterval(reconnectIfNeeded, 15_000);
	}

	onWS('channel_key', (payload: any) => {
		const { channel_id } = payload;
		const hasKey = useChannelStore.getState().channels.some(c => c.id === channel_id);
		
		// Only play sound if we didn't have the channel AND we are already connected for a while (avoiding login burst)
		const isLoginBurst = (Date.now() - connectTime) < 2000;
		if (!hasKey && !isLoginBurst) {
			playNotificationSound('new-group');
		}

		debouncedRefresh();
	});

	onWS('message', async (payload: unknown) => {
		const msg = payload as Message;
		const { activeChannel, incrementUnread, bumpLastMessage, channels } = useChannelStore.getState();
		const currentUserId = useAuthStore.getState().user?.id;

		// Bump conversation-list recency for every message, including our own
		// (sent from another session/device), so ordering stays Telegram-like.
		// The preview decrypts async and patches in via bumpLastMessage's
		// optional preview/messageId args once it resolves.
		bumpLastMessage(msg.channel_id, msg.sent_at, undefined, msg.id);
		const channelForPreview = channels.find((c) => c.id === msg.channel_id);
		if (channelForPreview) {
			buildMessagePreview(
				channelForPreview,
				msg.sender_id,
				msg.type,
				msg.ciphertext,
				msg.nonce,
				currentUserId || '',
			)
				.then((preview) => bumpLastMessage(msg.channel_id, msg.sent_at, preview, msg.id))
				.catch(() => {});
		}

		// If this channel is not in our channel list (e.g. was previously cleared/deleted by this user,
		// or user was newly added), refresh the channels list so it reappears.
		if (!channels.some((c) => c.id === msg.channel_id)) {
			debouncedRefresh();
		}

		// 1. NEVER increment unread for our own messages
		if (currentUserId && msg.sender_id === currentUserId) return;

		// 2. If viewing the channel, send read receipt. Otherwise, increment unread.
		if (activeChannel?.id === msg.channel_id) {
			wsSendReadReceipt(msg.channel_id);
		} else {
			incrementUnread(msg.channel_id);
			
			// Play sound
			playNotificationSound('message');
			
			// Show browser notification if tab is hidden/unfocused
			if (document.visibilityState !== 'visible' || !document.hasFocus()) {
				const channel = channels.find(c => c.id === msg.channel_id);
				if (channel && currentUserId) {
					const senderName = channel.member_names?.[msg.sender_id] || 'Someone';
					const channelName = getChannelDisplayName(channel, currentUserId);
					const text = msg.type === 'text' ? await decryptMessage(msg) : `Sent a ${msg.type}`;
					showBrowserNotification(`${senderName} (#${channelName})`, text);
				}
			}
		}
	});

	onWS('presence', (payload: any) => {
		if (payload && payload.user_id && payload.status) {
			const { user, updateStatus } = useAuthStore.getState();
			
			// Update our own status if it changed
			if (user && payload.user_id === user.id) {
				updateStatus(payload.status);
			}
			
			// Update status in channel members list
			useChannelStore.getState().updateMemberStatus(payload.user_id, payload.status);
		}

		// Invalidate queries to refresh status in UI
		const queryClient = (window as any).queryClient;
		if (queryClient) {
			queryClient.invalidateQueries({ queryKey: ['channels'] });
			const activeChannelId = useChannelStore.getState().activeChannel?.id;
			if (activeChannelId) {
				queryClient.invalidateQueries({ queryKey: ['channels', activeChannelId, 'members'] });
			}
		}
	});

	onWS('channel_update', (payload: any) => {
		const { type, channel_id, name, description, avatar_id, is_private } = payload;
		if (type === 'settings_updated' && channel_id) {
			useChannelStore.getState().updateChannelSettings(channel_id, {
				name,
				description,
				avatar_id,
				is_private,
			});
		}
		debouncedRefresh();
	});

	onWS('channel_delete', (payload: any) => {
		const { channel_id } = payload || {};
		if (channel_id) {
			useChannelStore.getState().removeChannel(channel_id);
			const queryClient = (window as any).queryClient;
			if (queryClient) {
				queryClient.removeQueries({ queryKey: ['messages', channel_id] });
				queryClient.invalidateQueries({ queryKey: ['channels'] });
			}
			const voiceState = useVoiceStore.getState();
			if (voiceState.activeChannelId === channel_id && voiceState.isActive) {
				voiceState.leaveVoice();
			}
		}
	});

	// Keep the sidebar preview from going stale if the channel's current
	// last message gets edited or deleted while that channel isn't open
	// (ChatArea's own message_update/message_delete listeners only run for
	// the currently-open channel).
	onWS('message_update', async (payload: unknown) => {
		const msg = payload as Message;
		const { channels, bumpLastMessage } = useChannelStore.getState();
		const channel = channels.find((c) => c.id === msg.channel_id);
		if (!channel || channel.last_message_id !== msg.id) return;
		const currentUserId = useAuthStore.getState().user?.id;
		const preview = await buildMessagePreview(
			channel,
			msg.sender_id,
			msg.type,
			msg.ciphertext,
			msg.nonce,
			currentUserId || '',
		);
		bumpLastMessage(msg.channel_id, msg.sent_at, preview, msg.id);
	});

	onWS('message_delete', (payload: any) => {
		const { channel_id, message_id } = payload || {};
		if (channel_id && message_id) {
			useChannelStore.getState().clearLastMessageIfCurrent(channel_id, message_id);
		}
	});

	onWS('relationship_update', () => {
		useAuthStore.getState().fetchRelationships();
		useAuthStore.getState().fetchIncomingRequests();
	});

	onWS('video_ready', (payload: any) => {
		const queryClient = (window as any).queryClient;
		if (queryClient && payload?.channel_id) {
			queryClient.invalidateQueries({ queryKey: ['messages', payload.channel_id] });
		}
	});
}

export function connectWS(token?: string) {
	connectTime = Date.now();
	useAppStore.getState().setWsState('connecting');
	initWebSocket(); // Register listeners FIRST
	wsConnect(token); // Then connect
}

export function disconnectWS() {
	wsDisconnect();
	useAppStore.getState().setWsState('disconnected');
}
