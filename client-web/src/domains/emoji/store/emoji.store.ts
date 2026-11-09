import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { pushRecent, sanitizeRecents } from '../utils/emoji-settings';

/** Per-device emoji preferences (decision: the style is chosen per device, not synced). */
interface EmojiSettingsState {
	/** Chosen style id, or null to follow the server default. */
	style: string | null;
	/** Explicit "Animated emoji" switch, or null to follow the OS reduced-motion preference. */
	animated: boolean | null;
	/** Recently used emoji (unicode characters or `:name:` shortcodes), newest first. */
	recents: string[];
	/** Skin tone for people emoji in the picker: 1 (default) to 6. */
	skinTone: number;
	/** Where the panel shows: a popover above the composer, or docked as a side column on wide windows. */
	panelMode: 'popover' | 'dock';
	/** Whether the docked panel is open (remembered, like Telegram's side panel). */
	dockOpen: boolean;
	setPanelMode: (mode: 'popover' | 'dock') => void;
	setDockOpen: (open: boolean) => void;
	setStyle: (style: string | null) => void;
	setAnimated: (animated: boolean | null) => void;
	addRecent: (emoji: string) => void;
	setSkinTone: (tone: number) => void;
}

export const useEmojiSettings = create<EmojiSettingsState>()(
	persist(
		(set) => ({
			style: null,
			animated: null,
			recents: [],
			skinTone: 1,
			panelMode: 'popover',
			dockOpen: false,
			setPanelMode: (panelMode) => set({ panelMode }),
			setDockOpen: (dockOpen) => set({ dockOpen }),
			setStyle: (style) => set({ style }),
			setAnimated: (animated) => set({ animated }),
			setSkinTone: (skinTone) => set({ skinTone: Math.min(6, Math.max(1, Math.round(skinTone))) }),
			addRecent: (emoji) => set((s) => ({ recents: pushRecent(s.recents, emoji) })),
		}),
		{
			name: 'cove_emoji_settings',
			// Repair what older builds may have stored (entries that drew as empty cells).
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<EmojiSettingsState>;
				return { ...current, ...saved, recents: sanitizeRecents(saved.recents) };
			},
		},
	),
);
