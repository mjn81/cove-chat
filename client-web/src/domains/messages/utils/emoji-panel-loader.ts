import { getPickerCategories } from '@/domains/emoji/utils/picker-cache';
import { useEmojiSettings } from '@/domains/emoji/store/emoji.store';

export const loadPanel = () => import('../components/emoji-sticker-panel');
let preloaded: Promise<unknown> | null = null;

/**
 * Warms everything the panel needs so the first open is instant: the lazy chunk and the shaped emoji data. (The
 * active style's sheet is already loaded by the first message that shows an emoji.) Safe to call repeatedly.
 */
export function preloadComposerEmojiPanel(): Promise<unknown> {
	preloaded ??= Promise.all([loadPanel(), getPickerCategories(useEmojiSettings.getState().skinTone)]).catch(() => {
		preloaded = null; // try again on the next hover or open
	});
	return preloaded;
}

/** Runs {@link preloadComposerEmojiPanel} when the browser is idle (or soon after, where `requestIdleCallback` is missing). */
export function preloadComposerEmojiPanelWhenIdle(): () => void {
	const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
	if (w.requestIdleCallback) {
		const id = w.requestIdleCallback(() => void preloadComposerEmojiPanel());
		return () => w.cancelIdleCallback?.(id);
	}
	const id = window.setTimeout(() => void preloadComposerEmojiPanel(), 1500);
	return () => window.clearTimeout(id);
}

