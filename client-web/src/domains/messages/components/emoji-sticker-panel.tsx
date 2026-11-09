import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import EmojiPickerBody, { type EmojiPickInfo } from '@/domains/emoji/components/emoji-picker-body';
import { StickerPanel } from '@/domains/stickers/components/sticker-panel';
import type { PackItem } from '@/domains/stickers/types/stickers.types';

interface EmojiStickerPanelProps {
	/** Whether the server supports stickers; without it the panel is the emoji picker alone. */
	stickersEnabled: boolean;
	onEmoji: (text: string, info: EmojiPickInfo) => void;
	onSticker: (packId: string, item: PackItem) => void;
}

/** Panel box, identical for every tab and for servers without stickers: switching tabs never resizes it. */
const PANEL_CLASS = 'h-[440px] w-full rounded-2xl';

/**
 * The composer's emoji and sticker panel, laid out like Telegram's: Emoji and Stickers tabs at the top with a short
 * underline under the active one, then the tab's content. Loaded lazily by the composer, so none of this is in the
 * first-load bundle.
 */
export default function EmojiStickerPanel({ stickersEnabled, onEmoji, onSticker }: EmojiStickerPanelProps) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');

	if (!stickersEnabled) return <EmojiPickerBody onSelect={onEmoji} className={PANEL_CLASS} />;

	const tabs = [
		{ id: 'emoji' as const, label: t('emoji.panel.emoji') },
		{ id: 'stickers' as const, label: t('emoji.panel.stickers') },
	];
	return (
		<div className={cn('flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground', PANEL_CLASS)}>
			<div role="tablist" className="flex">
				{tabs.map((x) => (
					<button
						key={x.id}
						type="button"
						role="tab"
						// Keep the caret in the composer when switching tabs.
						onMouseDown={(e) => e.preventDefault()}
						aria-selected={tab === x.id}
						className={cn(
							'relative flex-1 py-3 text-sm font-medium transition-colors',
							tab === x.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
						)}
						onClick={() => setTab(x.id)}
					>
						{x.label}
						{tab === x.id && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 mx-auto h-0.5 w-10 rounded-full bg-primary" />}
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1">
				{tab === 'emoji' ? (
					<EmojiPickerBody onSelect={onEmoji} className="h-full rounded-none border-0" />
				) : (
					<StickerPanel onSend={onSticker} />
				)}
			</div>
		</div>
	);
}
