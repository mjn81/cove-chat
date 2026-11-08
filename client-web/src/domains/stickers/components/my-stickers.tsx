import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Plus, Sticker } from 'lucide-react';

import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/store';
import { useCreatePack, usePacks, useUninstallPack } from '../hooks/use-packs';
import type { Pack } from '../types/stickers.types';
import { groupPacks } from '../utils/pack-groups';
import { packErrorMessage } from '../utils/pack-errors';
import { canCreatePack } from '../utils/sticker-upload';
import { PackDetailDialog } from './pack-detail-dialog';
import { PackEditor } from './pack-editor';
import { StickerImage } from './sticker-image';

/** Formats a byte count as megabytes for the storage line. */
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Settings section "My stickers": the packs the user made (open one to edit it), the packs they added from others
 * (remove or preview), and a button to create a pack that is disabled with an explanation when the admin switched
 * uploads off or the pack limit is reached.
 */
export function MyStickers() {
	const { t } = useTranslation();
	const userId = useAuthStore((s) => s.user?.id);
	const { data, isLoading } = usePacks();
	const create = useCreatePack();
	const uninstall = useUninstallPack();
	const [editing, setEditing] = useState<string | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState('');

	if (editing) return <PackEditor packId={editing} onBack={() => setEditing(null)} />;

	const quota = data?.quota;
	const groups = groupPacks(data?.items ?? [], userId);
	const can = canCreatePack(quota);

	const submit = async () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		try {
			const pack = await create.mutateAsync({ name: trimmed });
			setCreating(false);
			setName('');
			setEditing(pack.id);
		} catch (err) {
			toast.error(packErrorMessage(err, t));
		}
	};

	const row = (pack: Pack, actions: React.ReactNode, onOpen: () => void) => (
		<li key={pack.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
			<button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-start">
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted/40">
					{pack.cover_url ? <StickerImage path={pack.cover_url} alt="" size={40} /> : <Sticker className="h-5 w-5 text-muted-foreground" />}
				</span>
				<span className="min-w-0">
					<span className="block truncate text-sm font-medium text-foreground">{pack.name}</span>
					<span className="block truncate text-xs text-muted-foreground">
						{t('stickers.pack.count', { count: pack.item_count })}
						{pack.owner_name && pack.owner_id !== userId ? ` · ${pack.owner_name}` : ''}
					</span>
				</span>
			</button>
			{actions}
		</li>
	);

	return (
		<section className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="text-lg font-semibold text-foreground">{t('stickers.manager.title')}</h3>
					{quota && (
						<p className="text-xs text-muted-foreground">
							{t('stickers.manager.quota', {
								packs: quota.owned_packs,
								maxPacks: quota.max_packs,
								used: megabytes(quota.used_storage_bytes),
								max: megabytes(quota.max_storage_bytes),
							})}
						</p>
					)}
				</div>
				<Button type="button" size="sm" disabled={can !== 'ok'} onClick={() => setCreating(true)}>
					<Plus className="h-4 w-4" />
					{t('stickers.manager.new_pack')}
				</Button>
			</div>
			{can !== 'ok' && (
				<p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
					{t(can === 'uploads_disabled' ? 'stickers.problems.uploads_disabled' : 'stickers.problems.pack_limit')}
				</p>
			)}

			{isLoading ? (
				<div className="flex justify-center py-6 text-muted-foreground">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : (
				<>
					<div className="space-y-2">
						<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('stickers.manager.mine')}</h4>
						{groups.mine.length === 0 ? (
							<p className="text-sm text-muted-foreground">{t('stickers.manager.none_mine')}</p>
						) : (
							<ul className="space-y-2">
								{groups.mine.map((p) =>
									row(
										p,
										<Button type="button" size="sm" variant="outline" onClick={() => setEditing(p.id)}>
											{t('stickers.manager.edit')}
										</Button>,
										() => setEditing(p.id),
									),
								)}
							</ul>
						)}
					</div>
					{groups.installed.length > 0 && (
						<div className="space-y-2">
							<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('stickers.manager.added')}</h4>
							<ul className="space-y-2">
								{groups.installed.map((p) =>
									row(
										p,
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={uninstall.isPending}
											onClick={() => uninstall.mutate(p.id, { onError: (err) => toast.error(packErrorMessage(err, t)) })}
										>
											{t('stickers.pack.remove')}
										</Button>,
										() => setPreview(p.id),
									),
								)}
							</ul>
						</div>
					)}
				</>
			)}

			<ModalShell
				open={creating}
				onOpenChange={(open) => !open && setCreating(false)}
				title={t('stickers.manager.new_pack')}
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
			<PackDetailDialog packId={preview} onOpenChange={(open) => !open && setPreview(null)} />
		</section>
	);
}
