import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelRight, PanelRightClose, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import EmojiPickerBody, { type EmojiPickInfo } from '@/domains/emoji/components/emoji-picker-body';
import { StickerPanel } from '@/domains/stickers/components/sticker-panel';
import type { PackItem } from '@/domains/stickers/types/stickers.types';

interface EmojiStickerPanelProps {
	/** Whether the server supports stickers; without it the panel is the emoji picker alone. */
	stickersEnabled: boolean;
	onEmoji: (text: string, info: EmojiPickInfo) => void;
	onSticker: (packId: string, item: PackItem) => void;
	/** Fill the parent box (the docked side column) instead of using the popover size. */
	fill?: boolean;
	/** Dock controls: switch between popover and docked side panel, and close the docked panel. */
	dock?: { docked: boolean; onToggle: () => void; onClose?: () => void };
}

/** Panel box, identical for every tab and for servers without stickers: switching tabs never resizes it. */
const PANEL_CLASS = 'h-[440px] w-full rounded-2xl';

/**
 * The composer's emoji and sticker panel, laid out like Telegram's: Emoji and Stickers tabs at the top with a short
 * underline under the active one, then the tab's content. Loaded lazily by the composer, so none of this is in the
 * first-load bundle.
 */
export default function EmojiStickerPanel({ stickersEnabled, onEmoji, onSticker, fill, dock }: EmojiStickerPanelProps) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');

	// Docked: flat, borderless, fills the column. Popover (fixed-position box that sizes itself): rounded, fills the box.
	const box = fill ? (dock?.docked ? 'h-full w-full rounded-none border-0' : 'h-full w-full rounded-2xl') : PANEL_CLASS;
	const dockButtons = dock && (
		<div className="flex items-center gap-0.5 pe-1">
			<button
				type="button"
				onMouseDown={(e) => e.preventDefault()}
				onClick={dock.onToggle}
				title={dock.docked ? t('emoji.panel.undock') : t('emoji.panel.dock')}
				aria-label={dock.docked ? t('emoji.panel.undock') : t('emoji.panel.dock')}
				className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				{dock.docked ? <PanelRightClose size={16} className="rtl:-scale-x-100" /> : <PanelRight size={16} className="rtl:-scale-x-100" />}
			</button>
			{dock.docked && dock.onClose && (
				<button
					type="button"
					onMouseDown={(e) => e.preventDefault()}
					onClick={dock.onClose}
					title={t('emoji.panel.close')}
					aria-label={t('emoji.panel.close')}
					className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<X size={16} />
				</button>
			)}
		</div>
	);

	if (!stickersEnabled) {
		return (
			<div className={cn('flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground', box)}>
				{dock && <div className="flex justify-end pt-1">{dockButtons}</div>}
				<div className="min-h-0 flex-1">
					<EmojiPickerBody onSelect={onEmoji} className="h-full rounded-none border-0" />
				</div>
			</div>
		);
	}

	const tabs = [
		{ id: 'emoji' as const, label: t('emoji.panel.emoji') },
		{ id: 'stickers' as const, label: t('emoji.panel.stickers') },
	];
	return (
		<div className={cn('flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground', box)}>
			<div className="flex items-center">
			<div role="tablist" className="flex flex-1">
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
			{dockButtons}
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
