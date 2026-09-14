// channels.slice.ts
import { create } from 'zustand';
import { apiListChannels, apiCreateChannel } from '@/api/client';
import type { Channel } from '@/types/api';
import { wsSendReadReceipt } from '@/ws';

export interface ChannelSlice {
	channels: Channel[];
	activeChannel: Channel | null;
	isChannelsLoading: boolean;

	refreshChannels: () => Promise<void>;
	setActiveChannel: (ch: Channel | null) => void;
	createChannel: (name: string, memberIds: string[], isPrivate: boolean) => Promise<Channel>;
	incrementUnread: (id: string) => void;
	updateMemberStatus: (userId: string, status: string) => void;
	updateChannelSettings: (id: string, settings: Partial<{ name: string; is_private: boolean }>) => void;
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

	createChannel: async (name, memberIds, isPrivate) => {
		const ch = await apiCreateChannel(name, memberIds, isPrivate);
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

	updateChannelSettings: (id, settings) => {
		set((state) => {
			const update = (c: Channel) => (c.id === id ? { ...c, ...settings } : c);
			return {
				channels: state.channels.map(update),
				activeChannel: state.activeChannel ? update(state.activeChannel) : null,
			};
		});
	},

	resetChannels: () => {
		set({ channels: [], activeChannel: null });
	},
}));
