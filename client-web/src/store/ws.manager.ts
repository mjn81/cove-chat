// ws.manager.ts
import { wsConnect, wsDisconnect, onWS, wsSendReadReceipt, decryptMessage } from '@/ws';
import { useChannelStore, useAuthStore, getChannelDisplayName } from './store';
import { playNotificationSound, showBrowserNotification } from '@/utils/notifications';
import type { Message } from '@/types/api';
import { useAppStore } from './app.slice';
import { useVoiceStore } from './voiceStore';
import { buildMessagePreview } from '@/utils/messagePreview';
import { initWhisperListeners } from './whisperStore';
import { isDirectMessage } from '@/utils/channel';

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

	initWhisperListeners();

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
		// Wait for the preview to build before bumping so that recency and
		// preview update in a single atomic dispatch (avoids animation stutter/flicker).
		const channelForPreview = channels.find((c) => c.id === msg.channel_id);
		if (channelForPreview) {
			try {
				const preview = await buildMessagePreview(
					channelForPreview,
					msg.sender_id,
					msg.type,
					msg.ciphertext,
					msg.nonce,
					currentUserId || '',
				);
				bumpLastMessage(msg.channel_id, msg.sent_at, preview, msg.id);
			} catch {
				bumpLastMessage(msg.channel_id, msg.sent_at, undefined, msg.id);
			}
		} else {
			bumpLastMessage(msg.channel_id, msg.sent_at, undefined, msg.id);
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

	useChannelStore.subscribe((state, prevState) => {
		if (state.channels !== prevState.channels && state.channels.length > 0) {
			const voiceStore = useVoiceStore.getState();
			for (const [chId, users] of Object.entries(voiceStore.participants)) {
				if (users && users.length > 0) {
					checkIncomingCall(chId, users);
				}
			}
		}
	});

	onWS('voice_update', (rawPayload: unknown) => {
		const payload = rawPayload as { channel_id?: string; users?: string[] };
		if (!payload?.channel_id) return;

		const users = Array.isArray(payload.users) ? payload.users : [];
		const store = useVoiceStore.getState();
		store.updateParticipants(payload.channel_id, users);

		if (users.length === 0) {
			store.resetHandledCall(payload.channel_id);
			if (store.incomingCall?.channelId === payload.channel_id) {
				store.dismissIncomingCall();
			}
			return;
		}

		checkIncomingCall(payload.channel_id, users);
	});
}

export function checkIncomingCall(channelId: string, users: string[]) {
	if (users.length === 0) return;
	const store = useVoiceStore.getState();
	const currentUser = useAuthStore.getState().user;
	const channels = useChannelStore.getState().channels;
	const channel = channels.find((c) => c.id === channelId);

	// If this is a direct message, check for incoming call
	if (channel && isDirectMessage(channel)) {
		const isUserInCall = store.isActive && store.activeChannelId === channelId;
		const isAlreadyHandled = store.handledCallChannels.has(channelId);
		const otherMemberId = channel.members.find((m) => m !== currentUser?.id);
		const callerId = users.find((id) => id !== currentUser?.id);

		if (!isUserInCall && !isAlreadyHandled && callerId && otherMemberId === callerId) {
			const callerName = channel.member_names?.[callerId] || 'Someone';
			const callerAvatar = channel.member_avatars?.[callerId];
			store.setIncomingCall({
				channelId: channel.id,
				callerId,
				callerUsername: callerName,
				callerAvatarId: callerAvatar,
				timestamp: Date.now(),
			});
			showBrowserNotification('Incoming Call', `${callerName} is calling you...`);
		}
	}
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
