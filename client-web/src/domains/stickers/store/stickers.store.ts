import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { pushRecentSticker, type RecentSticker } from '../utils/recent-stickers';

/** Per-device sticker panel state. */
interface StickersState {
	recents: RecentSticker[];
	/** Pack tab the panel last showed (`recent` or a pack id), so it reopens where the user left it. */
	lastTab: string | null;
	addRecent: (sticker: RecentSticker) => void;
	setRecents: (recents: RecentSticker[]) => void;
	setLastTab: (tab: string) => void;
}

export const useStickersStore = create<StickersState>()(
	persist(
		(set) => ({
			recents: [],
			lastTab: null,
			addRecent: (sticker) => set((s) => ({ recents: pushRecentSticker(s.recents, sticker) })),
			setRecents: (recents) => set({ recents }),
			setLastTab: (lastTab) => set({ lastTab }),
		}),
		{ name: 'cove_stickers' },
	),
);
