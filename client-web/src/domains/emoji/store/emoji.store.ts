import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { pushRecent } from '../utils/emoji-settings';

/** Per-device emoji preferences (decision: the style is chosen per device, not synced). */
interface EmojiSettingsState {
	/** Chosen style id, or null to follow the server default. */
	style: string | null;
	/** Explicit "Animated emoji" switch, or null to follow the OS reduced-motion preference. */
	animated: boolean | null;
	/** Recently used emoji (unicode characters or `:name:` shortcodes), newest first. */
	recents: string[];
	setStyle: (style: string | null) => void;
	setAnimated: (animated: boolean | null) => void;
	addRecent: (emoji: string) => void;
}

export const useEmojiSettings = create<EmojiSettingsState>()(
	persist(
		(set) => ({
			style: null,
			animated: null,
			recents: [],
			setStyle: (style) => set({ style }),
			setAnimated: (animated) => set({ animated }),
			addRecent: (emoji) => set((s) => ({ recents: pushRecent(s.recents, emoji) })),
		}),
		{ name: 'cove_emoji_settings' },
	),
);
