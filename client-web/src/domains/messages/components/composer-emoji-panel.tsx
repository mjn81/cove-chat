import { Suspense, lazy, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

import type { PackItem } from '@/domains/stickers/types/stickers.types';

// Picker, emoji dataset and sticker grid are one lazy chunk: nothing of it loads until the panel is first opened.
const EmojiStickerPanel = lazy(() => import('./emoji-sticker-panel'));

interface ComposerEmojiPanelProps {
	stickersEnabled: boolean;
	onEmoji: (text: string) => void;
	onSticker: (packId: string, item: PackItem) => void;
	onClose: () => void;
}

/** Lazy-loaded emoji and sticker panel that closes on a click outside, anchored by the composer. */
export function ComposerEmojiPanel({ stickersEnabled, onEmoji, onSticker, onClose }: ComposerEmojiPanelProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handler = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		document.addEventListener('pointerdown', handler);
		return () => document.removeEventListener('pointerdown', handler);
	}, [onClose]);

	return (
		<div ref={ref} className="w-full">
			<Suspense
				fallback={
					<div className="flex h-[380px] items-center justify-center rounded-lg border border-border bg-popover text-muted-foreground">
						<Loader2 size={18} className="animate-spin" />
					</div>
				}
			>
				<EmojiStickerPanel stickersEnabled={stickersEnabled} onEmoji={onEmoji} onSticker={onSticker} />
			</Suspense>
		</div>
	);
}
