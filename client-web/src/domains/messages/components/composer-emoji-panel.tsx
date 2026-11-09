import { Suspense, lazy, useEffect, useRef } from 'react';

import type { EmojiPickInfo } from '@/domains/emoji/components/emoji-picker-body';
import { loadPanel } from '../utils/emoji-panel-loader';
import type { PackItem } from '@/domains/stickers/types/stickers.types';

// Picker, emoji dataset and sticker grid are one lazy chunk: nothing of it is in the first-load bundle.
const EmojiStickerPanel = lazy(loadPanel);

interface ComposerEmojiPanelProps {
	/** Whether the panel is showing. The component stays mounted while hidden so reopening is instant and keeps its scroll. */
	open: boolean;
	stickersEnabled: boolean;
	onEmoji: (text: string, info: EmojiPickInfo) => void;
	onSticker: (packId: string, item: PackItem) => void;
	onClose: () => void;
}

/**
 * Lazy-loaded emoji and sticker panel. It closes on a click outside (the emoji button, marked `data-emoji-toggle`,
 * handles its own clicks) or Escape, never after picking an emoji.
 */
export function ComposerEmojiPanel({ open, stickersEnabled, onEmoji, onSticker, onClose }: ComposerEmojiPanelProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const pointer = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (ref.current?.contains(target as Node) || target?.closest?.('[data-emoji-toggle]')) return;
			// Select menus render in a portal outside the panel; a click inside one is not "outside".
			if (target?.closest?.('[role="listbox"], [data-radix-popper-content-wrapper]')) return;
			onClose();
		};
		const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		document.addEventListener('pointerdown', pointer);
		document.addEventListener('keydown', key);
		return () => {
			document.removeEventListener('pointerdown', pointer);
			document.removeEventListener('keydown', key);
		};
	}, [open, onClose]);

	return (
		<div ref={ref} className="w-full" hidden={!open}>
			<Suspense fallback={<div className="h-[440px] rounded-xl border border-border bg-popover" aria-hidden="true" />}>
				<EmojiStickerPanel stickersEnabled={stickersEnabled} onEmoji={onEmoji} onSticker={onSticker} />
			</Suspense>
		</div>
	);
}
