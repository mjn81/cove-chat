import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Trash2 } from 'lucide-react';

import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { AddStickerFlow } from '@/domains/stickers/components/add-sticker-flow';
import { StickerImage } from '@/domains/stickers/components/sticker-image';
import { usePack } from '@/domains/stickers/hooks/use-packs';
import { moveItem } from '@/domains/stickers/utils/pack-order';
import { packErrorMessage } from '@/domains/stickers/utils/pack-errors';
import { useAdminDeleteSticker, useAdminReorderStickers, useAdminUploadSticker } from '../api/use-admin-packs';

/**
 * Admin dialog for the stickers of a server pack: add (no user quotas), reorder and delete. Contents are read from
 * the public pack detail, which the server serves for built-in packs and for server packs while they are enabled.
 *
 * @param packId - Pack to manage; null keeps the dialog closed.
 */
export function AdminPackItems({ packId, onOpenChange }: { packId: string | null; onOpenChange: (open: boolean) => void }) {
	const { t } = useTranslation();
	const { data: pack, isLoading, isError } = usePack(packId ?? undefined);
	const upload = useAdminUploadSticker();
	const remove = useAdminDeleteSticker();
	const reorder = useAdminReorderStickers();
	const items = pack?.items ?? [];
	const fail = (err: unknown) => toast.error(packErrorMessage(err, t));
	const editable = pack?.scope === 'server';

	return (
		<ModalShell open={!!packId} onOpenChange={onOpenChange} title={pack?.name ?? t('admin.packs.items_title')} size="lg">
			{isLoading ? (
				<Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
			) : isError || !pack ? (
				<p className="py-6 text-center text-sm text-muted-foreground">{t('admin.packs.items_unavailable')}</p>
			) : (
				<div className="space-y-4">
					{editable && <AddStickerFlow packId={pack.id} stickersInPack={items.length} quota={undefined} uploader={upload} />}
					{!editable && <p className="text-xs text-muted-foreground">{t('admin.packs.builtin_readonly')}</p>}
					<ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
						{items.map((item, i) => (
							<li key={item.id} className="flex flex-col items-center gap-1 rounded-md border border-border bg-card p-2">
								<StickerImage path={item.url} alt={item.emoji ?? ''} size={72} />
								<span className="h-5 text-sm">{item.emoji}</span>
								{editable && (
									<div className="flex items-center gap-0.5">
										<Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0 || reorder.isPending} onClick={() => reorder.mutate({ packId: pack.id, itemIds: moveItem(items.map((x) => x.id), i, i - 1) }, { onError: fail })} aria-label={t('stickers.manager.move_earlier')}>
											<ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
										</Button>
										<Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate({ packId: pack.id, itemId: item.id }, { onError: fail })} aria-label={t('stickers.manager.delete_sticker')}>
											<Trash2 className="h-4 w-4" />
										</Button>
										<Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === items.length - 1 || reorder.isPending} onClick={() => reorder.mutate({ packId: pack.id, itemIds: moveItem(items.map((x) => x.id), i, i + 1) }, { onError: fail })} aria-label={t('stickers.manager.move_later')}>
											<ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
										</Button>
									</div>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</ModalShell>
	);
}
