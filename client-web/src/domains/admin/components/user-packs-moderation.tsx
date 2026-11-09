import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Sticker, Trash2 } from 'lucide-react';

import { ConfirmModal } from '@/components/ConfirmModal';
import { Button } from '@/components/ui/button';
import { StickerImage } from '@/domains/stickers/components/sticker-image';
import { PackDetailDialog } from '@/domains/stickers/components/pack-detail-dialog';
import type { Pack } from '@/domains/stickers/types/stickers.types';
import { packErrorMessage } from '@/domains/stickers/utils/pack-errors';
import { useAdminDeletePack, useAdminPacks } from '../api/use-admin-packs';
import { splitAdminPacks } from '../utils/admin-packs';

/**
 * Moderation list of every user-made pack with its owner. Opening one previews its stickers; deleting removes the
 * pack and its images (written to the audit log with the owner, as `pack.delete`). Owner and admins both may.
 */
export function UserPacksModeration() {
	const { t } = useTranslation();
	const { data, isLoading } = useAdminPacks();
	const remove = useAdminDeletePack();
	const [preview, setPreview] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Pack | null>(null);

	if (isLoading) return <Loader2 className="animate-spin text-muted-foreground" />;
	const { user } = splitAdminPacks(data?.items ?? []);

	return (
		<section className="space-y-3">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{t('admin.packs.moderation_title')}</h3>
				<p className="text-xs text-muted-foreground">{t('admin.packs.moderation_hint')}</p>
			</div>
			{user.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t('admin.packs.moderation_none')}</p>
			) : (
				<ul className="space-y-2">
					{user.map((p) => (
						<li key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
							<button type="button" onClick={() => setPreview(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
								<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted/40">
									{p.cover_url ? <StickerImage path={p.cover_url} alt="" size={32} /> : <Sticker className="h-4 w-4 text-muted-foreground" />}
								</span>
								<span className="min-w-0">
									<span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
									<span className="block truncate text-xs text-muted-foreground">
										{t('admin.packs.owner', { name: p.owner_name || p.owner_id || '?' })} · {t('stickers.pack.count', { count: p.item_count })}
									</span>
								</span>
							</button>
							<Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(p)} aria-label={t('admin.packs.delete')}>
								<Trash2 className="h-4 w-4" />
							</Button>
						</li>
					))}
				</ul>
			)}
			<PackDetailDialog packId={preview} onOpenChange={(open) => !open && setPreview(null)} />
			<ConfirmModal
				isOpen={!!deleting}
				onClose={() => setDeleting(null)}
				onConfirm={() => deleting && remove.mutate(deleting.id, { onError: (err) => toast.error(packErrorMessage(err, t)) })}
				title={t('admin.packs.delete')}
				message={t('admin.packs.delete_user_confirm', { name: deleting?.name ?? '', owner: deleting?.owner_name ?? '' })}
				confirmText={t('stickers.manager.delete')}
				variant="danger"
			/>
		</section>
	);
}
