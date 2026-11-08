import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/modal-shell';
import { useAuthStore } from '@/store/store';
import { useInstallPack, usePack, useUninstallPack } from '../hooks/use-packs';
import { packErrorMessage } from '../utils/pack-errors';
import { StickerImage } from './sticker-image';

interface PackDetailDialogProps {
	packId: string | null;
	onOpenChange: (open: boolean) => void;
}

/**
 * A pack's stickers with Add / Remove. Reached by tapping a sticker in chat or the "Add stickers" card. Built-in and
 * server packs are always in the picker, so they only show their contents; a user pack can be added or removed by
 * anyone who has it, and its owner just sees it.
 *
 * @param packId - The pack to show, or null to keep the dialog closed.
 */
export function PackDetailDialog({ packId, onOpenChange }: PackDetailDialogProps) {
	const { t } = useTranslation();
	const userId = useAuthStore((s) => s.user?.id);
	const { data: pack, isLoading, isError } = usePack(packId ?? undefined);
	const install = useInstallPack();
	const uninstall = useUninstallPack();
	const busy = install.isPending || uninstall.isPending;

	const toggle = async () => {
		if (!pack) return;
		try {
			if (pack.installed) await uninstall.mutateAsync(pack.id);
			else await install.mutateAsync(pack.id);
		} catch (err) {
			toast.error(packErrorMessage(err, t));
		}
	};

	const isUserPack = pack?.scope === 'user';
	const isOwner = !!pack && pack.owner_id === userId;

	return (
		<ModalShell
			open={!!packId}
			onOpenChange={onOpenChange}
			title={pack?.name ?? t('stickers.pack.title')}
			description={pack?.owner_name ? t('stickers.pack.by', { name: pack.owner_name }) : undefined}
			footer={
				isUserPack && !isOwner ? (
					<Button type="button" onClick={toggle} disabled={busy} variant={pack?.installed ? 'outline' : 'default'}>
						{busy && <Loader2 className="h-4 w-4 animate-spin" />}
						{pack?.installed ? t('stickers.pack.remove') : t('stickers.pack.add')}
					</Button>
				) : undefined
			}
		>
			{isLoading ? (
				<div className="flex justify-center py-10 text-muted-foreground">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : isError || !pack ? (
				<p className="py-6 text-center text-sm text-muted-foreground">{t('stickers.pack.unavailable')}</p>
			) : (
				<>
					{pack.description && <p className="mb-3 text-sm text-muted-foreground">{pack.description}</p>}
					<div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
						{(pack.items ?? []).map((item) => (
							<div key={item.id} className="flex items-center justify-center rounded-md bg-muted/40 p-1">
								<StickerImage path={item.url} alt={item.emoji ?? item.name ?? ''} size={72} />
							</div>
						))}
					</div>
					<p className="mt-3 text-xs text-muted-foreground">{t('stickers.pack.count', { count: pack.item_count })}</p>
				</>
			)}
		</ModalShell>
	);
}
