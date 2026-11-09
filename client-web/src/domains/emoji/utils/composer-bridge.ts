import type { PackItem } from '@/domains/stickers/types/stickers.types';

/**
 * Connects an emoji/sticker panel that lives outside the composer (the docked side panel) to the composer that is
 * currently mounted. The composer registers handlers while it exists; the panel calls them. Only one composer is
 * active at a time (the open chat), and the most recently mounted one wins.
 */
export interface ComposerHandlers {
	/** Insert text at the caret; `keyboard` says whether focus should stay in the panel. */
	insert: (text: string, info: { keyboard: boolean }) => void;
	/** Send a sticker as a message. */
	sticker: (packId: string, item: PackItem) => void;
}

let current: ComposerHandlers | null = null;

/**
 * Registers the active composer.
 *
 * @returns an unregister function that only clears the registration if it is still this composer's.
 */
export function registerComposer(handlers: ComposerHandlers): () => void {
	current = handlers;
	return () => {
		if (current === handlers) current = null;
	};
}

/** Whether a composer is mounted to receive panel input (false in read-only chats). */
export function hasComposer(): boolean {
	return current !== null;
}

/** Inserts text into the active composer, if any. */
export function insertIntoComposer(text: string, info: { keyboard: boolean }): void {
	current?.insert(text, info);
}

/** Sends a sticker through the active composer, if any. */
export function sendStickerFromPanel(packId: string, item: PackItem): void {
	current?.sticker(packId, item);
}
