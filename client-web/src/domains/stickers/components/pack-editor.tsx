import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Pencil, Share2, Trash2 } from 'lucide-react';

import { ConfirmModal } from '@/components/ConfirmModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeletePack, useDeleteSticker, usePack, usePacks, useRenamePack, useReorderStickers } from '../hooks/use-packs';
import { moveItem } from '../utils/pack-order';
import { packErrorMessage } from '../utils/pack-errors';
import { AddStickerFlow } from './add-sticker-flow';
import { PackShareDialog } from './pack-share-dialog';
import { StickerImage } from './sticker-image';

/**
 * Editor for one of the user's own packs: rename, add stickers, reorder (arrow buttons, which work with a keyboard
 * and mirror in RTL), delete a sticker, share the pack to chats, delete the pack.
 *
 * @param packId - The pack being edited.
 * @param onBack - Returns to the pack list (also called after the pack is deleted).
 */
export function PackEditor({ packId, onBack }: { packId: string; onBack: () => void }) {
	const { t } = useTranslation();
	const { data: pack, isLoading } = usePack(packId);
	const { data: list } = usePacks();
	const rename = useRenamePack();
	const removePack = useDeletePack();
	const removeSticker = useDeleteSticker();
	const reorder = useReorderStickers();
	const [name, setName] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [shareId, setShareId] = useState<string | null>(null);

	if (isLoading || !pack) {
		return (
			<div className="flex justify-center py-10 text-muted-foreground">
				<Loader2 className="h-5 w-5 animate-spin" />
			</div>
		);
	}

	const items = pack.items ?? [];
	const fail = (err: unknown) => toast.error(packErrorMessage(err, t));

	const saveName = async () => {
		const next = (name ?? '').trim();
		setName(null);
		if (!next || next === pack.name) return;
		try {
			await rename.mutateAsync({ id: pack.id, name: next });
		} catch (err) {
			fail(err);
		}
	};

	const move = async (from: number, to: number) => {
		const ids = moveItem(
			items.map((i) => i.id),
			from,
			to,
		);
		try {
			await reorder.mutateAsync({ packId: pack.id, itemIds: ids });
		} catch (err) {
			fail(err);
		}
	};

	return (
		<div className="space-y-5">
			<div className="flex items-center gap-2">
				<Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label={t('stickers.manager.back')}>
					<ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
				</Button>
				{name === null ? (
					<>
						<h3 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{pack.name}</h3>
						<Button type="button" variant="ghost" size="icon" onClick={() => setName(pack.name)} aria-label={t('stickers.manager.rename')}>
							<Pencil className="h-4 w-4" />
						</Button>
					</>
				) : (
					<Input
						autoFocus
						value={name}
						maxLength={64}
						onChange={(e) => setName(e.target.value)}
						onBlur={saveName}
						onKeyDown={(e) => e.key === 'Enter' && saveName()}
						aria-label={t('stickers.manager.name_label')}
						autoComplete="off"
						spellCheck={false}
					/>
				)}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<AddStickerFlow packId={pack.id} stickersInPack={items.length} quota={list?.quota} />
				<Button type="button" size="sm" variant="outline" onClick={() => setShareId(pack.id)} disabled={items.length === 0}>
					<Share2 className="h-4 w-4" />
					{t('stickers.manager.share')}
				</Button>
				<Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}>
					<Trash2 className="h-4 w-4" />
					{t('stickers.manager.delete_pack')}
				</Button>
				{list?.quota && (
					<span className="ms-auto text-xs text-muted-foreground">
						{t('stickers.manager.count_of', { count: items.length, max: list.quota.max_stickers_per_pack })}
					</span>
				)}
			</div>

			{items.length === 0 ? (
				<p className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('stickers.manager.empty_pack')}</p>
			) : (
				<ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
					{items.map((item, i) => (
						<li key={item.id} className="flex flex-col items-center gap-1 rounded-md border border-border bg-card p-2">
							<StickerImage path={item.url} alt={item.emoji ?? ''} size={80} />
							<span className="h-5 text-sm">{item.emoji}</span>
							<div className="flex items-center gap-0.5">
								<Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0 || reorder.isPending} onClick={() => move(i, i - 1)} aria-label={t('stickers.manager.move_earlier')}>
									<ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
								</Button>
								<Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={removeSticker.isPending} onClick={() => removeSticker.mutate({ packId: pack.id, itemId: item.id }, { onError: fail })} aria-label={t('stickers.manager.delete_sticker')}>
									<Trash2 className="h-4 w-4" />
								</Button>
								<Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, i + 1)} aria-label={t('stickers.manager.move_later')}>
									<ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}

			<ConfirmModal
				isOpen={confirmDelete}
				onClose={() => setConfirmDelete(false)}
				onConfirm={async () => {
					try {
						await removePack.mutateAsync(pack.id);
						onBack();
					} catch (err) {
						fail(err);
					}
				}}
				title={t('stickers.manager.delete_pack')}
				message={t('stickers.manager.delete_pack_confirm', { name: pack.name })}
				confirmText={t('stickers.manager.delete')}
				variant="danger"
			/>
			<PackShareDialog packId={shareId} onOpenChange={(open) => !open && setShareId(null)} />
		</div>
	);
}
