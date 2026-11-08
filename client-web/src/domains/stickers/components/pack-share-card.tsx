import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Loader2, Sticker } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/store';
import { useInstallPack, usePack } from '../hooks/use-packs';
import { packErrorMessage } from '../utils/pack-errors';
import { PackDetailDialog } from './pack-detail-dialog';
import { StickerImage } from './sticker-image';

/**
 * The "Add stickers" card for a shared pack (see `pack-share.ts` for the message format): cover, name, sticker
 * count and an Add button; tapping the card previews the whole pack. Mirrors the invite card.
 *
 * @param packId - Id from the share token.
 */
export function PackShareCard({ packId }: { packId: string }) {
	const { t } = useTranslation();
	const userId = useAuthStore((s) => s.user?.id);
	const { data: pack, isLoading, isError } = usePack(packId);
	const install = useInstallPack();
	const [preview, setPreview] = useState(false);

	if (isLoading) {
		return (
			<div className="flex h-20 w-72 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
			</div>
		);
	}
	if (isError || !pack) {
		return <span className="text-sm text-muted-foreground">{t('stickers.pack.unavailable')}</span>;
	}

	const mine = pack.owner_id === userId;
	const added = pack.installed || mine;
	const add = async () => {
		try {
			await install.mutateAsync(pack.id);
			toast.success(t('stickers.pack.added'));
		} catch (err) {
			toast.error(packErrorMessage(err, t));
		}
	};

	return (
		<>
			<div className="flex w-72 max-w-full items-center gap-3 rounded-lg border border-border bg-card p-3">
				<button
					type="button"
					onClick={() => setPreview(true)}
					className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-muted/40"
					aria-label={t('stickers.pack.preview')}
				>
					{pack.cover_url ? <StickerImage path={pack.cover_url} alt="" size={48} /> : <Sticker className="h-6 w-6 text-muted-foreground" />}
				</button>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold text-foreground">{pack.name}</div>
					<div className="truncate text-xs text-muted-foreground">
						{t('stickers.pack.count', { count: pack.item_count })}
						{pack.owner_name ? ` · ${pack.owner_name}` : ''}
					</div>
				</div>
				<Button type="button" size="sm" variant={added ? 'outline' : 'default'} disabled={added || install.isPending} onClick={add}>
					{added ? <Check className="h-4 w-4" /> : install.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
					{added ? t('stickers.pack.added_short') : t('stickers.pack.add_stickers')}
				</Button>
			</div>
			<PackDetailDialog packId={preview ? pack.id : null} onOpenChange={setPreview} />
		</>
	);
}
