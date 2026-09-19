// channels.slice.ts
import { create } from 'zustand';
import { apiListChannels, apiCreateChannel } from '@/api/client';
import type { Channel } from '@/types/api';
import { wsSendReadReceipt } from '@/ws';
import { useAuthStore } from './auth.slice';
import { buildMessagePreview } from '@/utils/messagePreview';

// Decrypts each channel's last-message ciphertext (returned by ListChannels)
// into a sidebar preview string. Fire-and-forget per channel so the list
// renders immediately and previews fill in as they decrypt, rather than
// blocking the whole channel list on every decrypt completing first.
function hydrateLastMessagePreviews(list: Channel[]) {
	const currentUserId = useAuthStore.getState().user?.id || '';
	for (const ch of list) {
		if (!ch.last_message_ciphertext || !ch.last_message_type || !ch.last_message_sender_id) {
			continue;
		}
		buildMessagePreview(
			ch,
			ch.last_message_sender_id,
			ch.last_message_type,
			ch.last_message_ciphertext,
			ch.last_message_nonce || '',
			currentUserId,
		)
			.then((preview) => useChannelStore.getState().setLastMessagePreview(ch.id, preview))
			.catch(() => {});
	}
}

export interface ChannelSlice {
	channels: Channel[];
	activeChannel: Channel | null;
	isChannelsLoading: boolean;

	refreshChannels: () => Promise<void>;
	setActiveChannel: (ch: Channel | null) => void;
	createChannel: (
		name: string,
		memberIds: string[],
		isPrivate: boolean,
		description?: string,
		avatarId?: string,
	) => Promise<Channel>;
	incrementUnread: (id: string) => void;
	bumpLastMessage: (id: string, timestamp: string, preview?: string, messageId?: string) => void;
	setLastMessagePreview: (id: string, preview: string | undefined) => void;
	clearLastMessageIfCurrent: (id: string, messageId: string) => void;
	updateMemberStatus: (userId: string, status: string) => void;
	updateMemberAvatar: (userId: string, avatarId: string) => void;
	updateChannelSettings: (id: string, settings: Partial<{ name: string; is_private: boolean; description: string; avatar_id: string }>) => void;
	removeChannel: (channelId: string) => void;
	resetChannels: () => void;
}

// Guards against out-of-order responses: refreshChannels() can be triggered
// repeatedly in quick succession (e.g. two channel_key WS events close
// together). Without sequencing, whichever request happens to resolve LAST
// always wins, even if it was the older, now-stale one — silently reverting
// the channel list to outdated data. Each call captures the sequence number
// current when it started; a response is only applied if no newer call has
// started since.
let refreshSeq = 0;

export const useChannelStore = create<ChannelSlice>((set) => ({
	channels: [],
	activeChannel: null,
	isChannelsLoading: false,

	refreshChannels: async () => {
		const seq = ++refreshSeq;
		const hasChannels = useChannelStore.getState().channels.length > 0;
		if (!hasChannels) set({ isChannelsLoading: true });

		try {
			const list = await apiListChannels();
			if (seq !== refreshSeq) return; // A newer refresh has since started — drop this stale result.
			set((state) => {
				const active = state.activeChannel;
				let nextActive = active;
				if (active) {
					// Update the active channel object to reflect new members/metadata
					const updated = list.find((c) => c.id === active.id);
					if (updated) nextActive = updated;
					else nextActive = null; // Channel was deleted or user was removed
				}
				return { channels: list, activeChannel: nextActive };
			});
			hydrateLastMessagePreviews(list);
		} finally {
			if (seq === refreshSeq) set({ isChannelsLoading: false });
		}
	},

	setActiveChannel: (ch) => {
		if (ch) wsSendReadReceipt(ch.id);
		set((state) => {
			if (state.activeChannel?.id === ch?.id) {
				// If clicking already active channel, only update unread count if it's > 0
				const target = state.channels.find(c => c.id === ch?.id);
				if (!target || (target.unread_count || 0) === 0) return state;
			}

			return {
				activeChannel: ch,
				channels: ch 
					? state.channels.map((c) => (c.id === ch.id && (c.unread_count || 0) > 0) ? { ...c, unread_count: 0 } : c)
					: state.channels,
			};
		});
	},

	incrementUnread: (id) => {
		set((state) => ({
			channels: state.channels.map((c) =>
				c.id === id ? { ...c, unread_count: (c.unread_count || 0) + 1 } : c,
			),
		}));
	},

	bumpLastMessage: (id, timestamp, preview, messageId) => {
		set((state) => ({
			channels: state.channels.map((c) =>
				c.id === id
					? {
							...c,
							last_message_at: timestamp,
							...(preview !== undefined ? { last_message_preview: preview } : {}),
							...(messageId !== undefined ? { last_message_id: messageId } : {}),
						}
					: c,
			),
		}));
	},

	setLastMessagePreview: (id, preview) => {
		set((state) => ({
			channels: state.channels.map((c) =>
				c.id === id ? { ...c, last_message_preview: preview } : c,
			),
		}));
	},

	// Clears the stored preview only if the deleted/otherwise-invalidated
	// message was actually the channel's current last message — avoids
	// wiping a still-valid preview when an older message elsewhere is deleted.
	clearLastMessageIfCurrent: (id, messageId) => {
		set((state) => ({
			channels: state.channels.map((c) =>
				c.id === id && c.last_message_id === messageId
					? { ...c, last_message_preview: undefined }
					: c,
			),
		}));
	},

	createChannel: async (name, memberIds, isPrivate, description, avatarId) => {
		const ch = await apiCreateChannel(name, memberIds, isPrivate, description, avatarId);
		set((s) => {
			const exists = s.channels.some((c) => c.id === ch.id);
			if (exists) return s;
			return { channels: [ch, ...s.channels] };
		});
		return ch;
	},
	updateMemberStatus: (userId, status) => {
		set((state) => {
			const updatedChannels = state.channels.map((c) => {
				if (c.members?.includes(userId)) {
					return {
						...c,
						member_statuses: {
							...(c.member_statuses || {}),
							[userId]: status,
						},
					};
				}
				return c;
			});

			const updatedActiveChannel =
				state.activeChannel && state.activeChannel.members?.includes(userId)
					? {
							...state.activeChannel,
							member_statuses: {
								...(state.activeChannel.member_statuses || {}),
								[userId]: status,
							},
						}
					: state.activeChannel;

			return {
				channels: updatedChannels,
				activeChannel: updatedActiveChannel,
			};
		});
	},

	updateMemberAvatar: (userId, avatarId) => {
		set((state) => {
			const updatedChannels = state.channels.map((c) => {
				if (c.members?.includes(userId)) {
					return {
						...c,
						member_avatars: {
							...(c.member_avatars || {}),
							[userId]: avatarId,
						},
					};
				}
				return c;
			});

			const updatedActiveChannel =
				state.activeChannel && state.activeChannel.members?.includes(userId)
					? {
							...state.activeChannel,
							member_avatars: {
								...(state.activeChannel.member_avatars || {}),
								[userId]: avatarId,
							},
						}
					: state.activeChannel;

			return {
				channels: updatedChannels,
				activeChannel: updatedActiveChannel,
			};
		});
	},

	updateChannelSettings: (id, settings) => {
		set((state) => {
			const update = (c: Channel) => (c.id === id ? { ...c, ...settings } : c);
			return {
				channels: state.channels.map(update),
				activeChannel: state.activeChannel ? update(state.activeChannel) : null,
			};
		});
	},

	removeChannel: (channelId: string) => {
		set((state) => ({
			channels: state.channels.filter((c) => c.id !== channelId),
			activeChannel: state.activeChannel?.id === channelId ? null : state.activeChannel,
		}));
	},

	resetChannels: () => {
		set({ channels: [], activeChannel: null });
	},
}));
