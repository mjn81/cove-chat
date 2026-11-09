import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Loader2, Sticker } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useElementSize } from '@/hooks/use-element-size';
import { stickerColumns } from '@/domains/emoji/utils/grid-layout';
import { useAuthStore } from '@/store/store';
import { usePack, usePacks } from '../hooks/use-packs';
import { useStickersStore } from '../store/stickers.store';
import type { PackItem } from '../types/stickers.types';
import { groupPacks, initialStickerTab, orderedPacks } from '../utils/pack-groups';
import { pruneRecentStickers } from '../utils/recent-stickers';
import { StickerImage } from './sticker-image';

interface StickerPanelProps {
	/** Called when the user taps a sticker. */
	onSend: (packId: string, item: PackItem) => void;
}

/** Padding inside each equal grid cell around the sticker. */
const GAP = 6;

/**
 * The sticker tab of the composer panel: a strip of tabs (recent, then server packs including the two default packs,
 * then my packs, then added packs) and the grid of the selected pack. Pack contents load when a tab is opened.
 *
 * @param onSend - Receives the pack id and the tapped sticker.
 */
export function StickerPanel({ onSend }: StickerPanelProps) {
	const { t } = useTranslation();
	const userId = useAuthStore((s) => s.user?.id);
	const { data, isLoading } = usePacks();
	// Columns follow the measured width and the cells share it equally, so there is never dead space at the side.
	const [gridRef, gridSize] = useElementSize<HTMLDivElement>();
	const gridStyle = { gridTemplateColumns: `repeat(${stickerColumns(gridSize.width)}, minmax(0, 1fr))` };
	const recents = useStickersStore((s) => s.recents);
	const lastTab = useStickersStore((s) => s.lastTab);
	const setLastTab = useStickersStore((s) => s.setLastTab);
	const addRecent = useStickersStore((s) => s.addRecent);

	const packs = useMemo(() => orderedPacks(groupPacks(data?.items ?? [], userId)), [data, userId]);
	const visibleRecents = useMemo(
		() => pruneRecentStickers(recents, new Set(packs.map((p) => p.id))),
		[recents, packs],
	);
	const [chosen, setChosen] = useState<string | null>(null);
	const active =
		chosen && (chosen === 'recent' ? visibleRecents.length > 0 : packs.some((p) => p.id === chosen))
			? chosen
			: initialStickerTab(
					packs.map((p) => p.id),
					lastTab,
					data?.default_pack_id,
					visibleRecents.length > 0,
				);
	const { data: pack, isLoading: packLoading } = usePack(active && active !== 'recent' ? active : undefined);

	const pick = (packId: string, item: PackItem) => {
		addRecent({ pack_id: packId, item: { id: item.id, url: item.url, file_id: item.file_id, animated: item.animated, emoji: item.emoji } });
		onSend(packId, item as PackItem);
	};

	const select = (tab: string) => {
		setChosen(tab);
		setLastTab(tab);
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<Loader2 size={18} className="animate-spin" />
			</div>
		);
	}
	if (packs.length === 0) {
		return <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{t('stickers.panel.empty')}</p>;
	}

	const tabButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground';
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div ref={gridRef} className="[scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_transparent] flex-1 overflow-y-auto px-1.5 pb-2">
				{active === 'recent' ? (
					<div className="grid" style={gridStyle}>
						{visibleRecents.map((r) => (
							<button
								key={`${r.pack_id}:${r.item.id}`}
								type="button"
								onClick={() => pick(r.pack_id, { ...r.item, bytes: 0, order: 0 })}
								aria-label={r.item.emoji ?? t('stickers.message.sticker')}
								className="flex aspect-square items-center justify-center rounded-xl hover:bg-accent"
								style={{ padding: GAP }}
							>
								<StickerImage path={r.item.url} alt={r.item.emoji ?? ''} fill />
							</button>
						))}
					</div>
				) : packLoading || !pack ? (
					<div className="flex h-full items-center justify-center text-muted-foreground">
						<Loader2 size={18} className="animate-spin" />
					</div>
				) : (
					<>
						<h3 className="sticky top-0 z-10 bg-popover/95 px-2 py-1.5 text-[13px] font-medium text-muted-foreground">{pack.name}</h3>
						<div className="grid" style={gridStyle}>
							{(pack.items ?? []).map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => pick(pack.id, item)}
									aria-label={item.emoji ?? item.name ?? t('stickers.message.sticker')}
									className="flex aspect-square items-center justify-center rounded-xl hover:bg-accent"
									style={{ padding: GAP }}
								>
									<StickerImage path={item.url} alt={item.emoji ?? ''} fill />
								</button>
							))}
						</div>
					</>
				)}
			</div>
			<div className="flex items-center gap-1 overflow-x-auto border-t border-border p-1">
				{visibleRecents.length > 0 && (
					<button
						type="button"
						title={t('stickers.panel.recent')}
						aria-label={t('stickers.panel.recent')}
						onClick={() => select('recent')}
						className={cn(tabButton, active === 'recent' && 'bg-accent text-foreground')}
					>
						<Clock size={18} />
					</button>
				)}
				{packs.map((p) => (
					<button
						key={p.id}
						type="button"
						title={p.name}
						aria-label={p.name}
						onClick={() => select(p.id)}
						className={cn(tabButton, active === p.id && 'bg-accent text-foreground')}
					>
						{p.cover_url ? <StickerImage path={p.cover_url} alt="" size={26} /> : <Sticker size={18} />}
					</button>
				))}
			</div>
		</div>
	);
}
