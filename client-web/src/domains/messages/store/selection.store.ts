import { create } from 'zustand';

import { toggleSelected } from '../utils/message-selection';

interface SelectionState {
	/** Channel the selection belongs to; switching chats clears it. */
	channelId: string | null;
	/** Selected message ids, in the order they were picked. */
	ids: string[];
	/** Selects or deselects one message of a chat; picking in another chat starts a fresh selection. */
	toggle: (channelId: string, id: string) => void;
	clear: () => void;
}

/** Client-only state for the multi-select mode of a chat (server data stays in React Query). */
export const useSelectionStore = create<SelectionState>((set) => ({
	channelId: null,
	ids: [],
	toggle: (channelId, id) =>
		set((s) => ({ channelId, ids: toggleSelected(s.channelId === channelId ? s.ids : [], id) })),
	clear: () => set({ channelId: null, ids: [] }),
}));
