import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import EmojiPickerBody from '@/domains/emoji/components/emoji-picker-body';
import { StickerPanel } from '@/domains/stickers/components/sticker-panel';
import type { PackItem } from '@/domains/stickers/types/stickers.types';

interface EmojiStickerPanelProps {
	/** Whether the server supports stickers; without it the panel is the emoji picker alone. */
	stickersEnabled: boolean;
	onEmoji: (text: string) => void;
	onSticker: (packId: string, item: PackItem) => void;
}

/**
 * The composer's emoji and sticker panel: an Emoji tab and, when the server has stickers, a Stickers tab. It is
 * loaded lazily by the composer, so none of this is in the first-load bundle.
 */
export default function EmojiStickerPanel({ stickersEnabled, onEmoji, onSticker }: EmojiStickerPanelProps) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');

	if (!stickersEnabled) return <EmojiPickerBody onSelect={onEmoji} />;

	const tabClass = (active: boolean) =>
		cn(
			'flex-1 rounded-md px-3 py-1 text-sm font-medium transition-colors',
			active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
		);
	return (
		<div className="flex h-[420px] w-full flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground">
			<div role="tablist" className="flex gap-1 border-b border-border p-1">
				<button type="button" role="tab" aria-selected={tab === 'emoji'} className={tabClass(tab === 'emoji')} onClick={() => setTab('emoji')}>
					{t('emoji.panel.emoji')}
				</button>
				<button type="button" role="tab" aria-selected={tab === 'stickers'} className={tabClass(tab === 'stickers')} onClick={() => setTab('stickers')}>
					{t('emoji.panel.stickers')}
				</button>
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
