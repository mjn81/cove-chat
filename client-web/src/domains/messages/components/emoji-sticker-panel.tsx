import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smile, Sticker } from 'lucide-react';

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
			'relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors',
			active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
		);
	const tabs = [
		{ id: 'emoji' as const, label: t('emoji.panel.emoji'), icon: Smile },
		{ id: 'stickers' as const, label: t('emoji.panel.stickers'), icon: Sticker },
	];
	return (
		<div className="flex h-[440px] w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-sm">
			<div role="tablist" className="flex border-b border-border">
				{tabs.map((x) => (
					<button
						key={x.id}
						type="button"
						role="tab"
						// Keep the caret in the composer when switching tabs.
						onMouseDown={(e) => e.preventDefault()}
						aria-selected={tab === x.id}
						className={tabClass(tab === x.id)}
						onClick={() => setTab(x.id)}
					>
						<x.icon size={16} />
						{x.label}
						{tab === x.id && <span aria-hidden="true" className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-primary" />}
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1">
				{tab === 'emoji' ? (
					<EmojiPickerBody onSelect={onEmoji} className="h-full rounded-none border-0 shadow-none" />
				) : (
					<StickerPanel onSend={onSticker} />
				)}
			</div>
		</div>
	);
}
