import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Image as ImageIcon, Loader2, Plus, Star, Trash2 } from 'lucide-react';

import { ConfirmModal } from '@/components/ConfirmModal';
import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { StickerImage } from '@/domains/stickers/components/sticker-image';
import type { Pack } from '@/domains/stickers/types/stickers.types';
import { packErrorMessage } from '@/domains/stickers/utils/pack-errors';
import { useAdminCreatePack, useAdminDeletePack, useAdminPacks, useAdminUpdatePack } from '../api/use-admin-packs';
import { splitAdminPacks, swapPackOrder } from '../utils/admin-packs';
import { AdminPackItems } from './admin-pack-items';

/**
 * Manager for the packs every user sees: the two built-in packs (enable, order, default; they cannot be deleted)
 * and server packs the admin creates (also rename, add stickers, delete). Only one pack is ever the default.
 */
export function ServerPacksSection() {
	const { t } = useTranslation();
	const { data, isLoading } = useAdminPacks();
	const update = useAdminUpdatePack();
	const create = useAdminCreatePack();
	const remove = useAdminDeletePack();
	const [name, setName] = useState('');
	const [creating, setCreating] = useState(false);
	const [managing, setManaging] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Pack | null>(null);

	if (isLoading) return <Loader2 className="animate-spin text-muted-foreground" />;
	const { managed } = splitAdminPacks(data?.items ?? []);
	const fail = (err: unknown) => toast.error(packErrorMessage(err, t));

	const move = async (index: number, dir: -1 | 1) => {
		try {
			for (const c of swapPackOrder(managed, index, dir)) await update.mutateAsync({ id: c.id, changes: { order: c.order } });
		} catch (err) {
			fail(err);
		}
	};

	const submit = async () => {
		if (!name.trim()) return;
		try {
			await create.mutateAsync({ name: name.trim() });
			setName('');
			setCreating(false);
		} catch (err) {
			fail(err);
		}
	};

	return (
		<section className="space-y-4">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h3 className="text-sm font-semibold text-foreground">{t('admin.packs.server_title')}</h3>
					<p className="text-xs text-muted-foreground">{t('admin.packs.server_hint')}</p>
				</div>
				<Button type="button" size="sm" onClick={() => setCreating(true)}>
					<Plus className="h-4 w-4" />
					{t('admin.packs.create_pack')}
				</Button>
			</div>
			<ul className="space-y-2">
				{managed.map((p, i) => (
					<li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
						<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted/40">
							{p.cover_url ? <StickerImage path={p.cover_url} alt="" size={32} /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-medium text-foreground">
								{p.name}
								{p.default && <span className="ms-2 text-xs font-medium text-primary">{t('admin.packs.default')}</span>}
							</div>
							<div className="text-xs text-muted-foreground">
								{t(p.scope === 'builtin' ? 'admin.packs.scope_builtin' : 'admin.packs.scope_server')} · {t('stickers.pack.count', { count: p.item_count })}
							</div>
						</div>
						<Switch
							checked={p.enabled}
							onCheckedChange={(enabled) => update.mutate({ id: p.id, changes: { enabled } }, { onError: fail })}
							aria-label={t('admin.packs.enabled')}
						/>
						<Button type="button" size="icon" variant="ghost" disabled={p.default || !p.enabled || update.isPending} onClick={() => update.mutate({ id: p.id, changes: { default: true } }, { onError: fail })} aria-label={t('admin.packs.make_default')} title={t('admin.packs.make_default')}>
							<Star className="h-4 w-4" />
						</Button>
						<Button type="button" size="icon" variant="ghost" disabled={i === 0 || update.isPending} onClick={() => move(i, -1)} aria-label={t('admin.packs.move_up')}>
							<ArrowUp className="h-4 w-4" />
						</Button>
						<Button type="button" size="icon" variant="ghost" disabled={i === managed.length - 1 || update.isPending} onClick={() => move(i, 1)} aria-label={t('admin.packs.move_down')}>
							<ArrowDown className="h-4 w-4" />
						</Button>
						<Button type="button" size="sm" variant="outline" onClick={() => setManaging(p.id)}>
							{t('admin.packs.stickers')}
						</Button>
						{p.scope === 'server' && (
							<Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(p)} aria-label={t('admin.packs.delete')}>
								<Trash2 className="h-4 w-4" />
							</Button>
						)}
					</li>
				))}
			</ul>

			<ModalShell
				open={creating}
				onOpenChange={(open) => !open && setCreating(false)}
				title={t('admin.packs.create_pack')}
				footer={
					<>
						<Button type="button" variant="ghost" onClick={() => setCreating(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="button" onClick={submit} disabled={!name.trim() || create.isPending}>
							{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							{t('stickers.manager.create')}
						</Button>
					</>
				}
			>
				<Input
					autoFocus
					value={name}
					maxLength={64}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && submit()}
					placeholder={t('stickers.manager.name_placeholder')}
					aria-label={t('stickers.manager.name_label')}
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
				/>
			</ModalShell>
			<ConfirmModal
				isOpen={!!deleting}
				onClose={() => setDeleting(null)}
				onConfirm={() => deleting && remove.mutate(deleting.id, { onError: fail })}
				title={t('admin.packs.delete')}
				message={t('admin.packs.delete_confirm', { name: deleting?.name ?? '' })}
				confirmText={t('stickers.manager.delete')}
				variant="danger"
			/>
			<AdminPackItems packId={managing} onOpenChange={(open) => !open && setManaging(null)} />
		</section>
	);
}
