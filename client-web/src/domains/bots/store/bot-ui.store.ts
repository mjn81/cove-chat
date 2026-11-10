import { create } from 'zustand';

import type { KeyboardMode } from '../utils/keyboard';

interface ModeEntry {
	/** Signature of the keyboard the choice was made for; a different keyboard resets the choice. */
	signature: string;
	mode: KeyboardMode;
}

interface BotUiState {
	/** Per channel: whether the user switched the action menu to typing, for the keyboard with this signature. */
	modes: Record<string, ModeEntry>;
	setMode: (channelId: string, signature: string, mode: KeyboardMode) => void;
	/** The mode for the keyboard with `signature` in `channelId`, or undefined when the user made no choice for it. */
	getMode: (channelId: string, signature: string) => KeyboardMode | undefined;
}

/** Client-only UI state of the bot action menu (never sent anywhere; resets on reload like a closed popup). */
export const useBotUiStore = create<BotUiState>((set, get) => ({
	modes: {},
	setMode: (channelId, signature, mode) =>
		set((s) => ({ modes: { ...s.modes, [channelId]: { signature, mode } } })),
	getMode: (channelId, signature) => {
		const entry = get().modes[channelId];
		return entry && entry.signature === signature ? entry.mode : undefined;
	},
}));
