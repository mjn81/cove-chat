import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { ModalShell } from '@/components/modal-shell';
import { useAttribution } from '../hooks/use-packs';
import type { AttributionEntry } from '../types/stickers.types';

/**
 * Credits for the emoji styles and sticker packs the server ships, as required by their licences (CC BY 4.0 art
 * needs a visible attribution). The list comes from `GET /api/packs/attribution`, which is generated from the
 * same data as the assets, so it cannot drift from what is shipped.
 *
 * @param open - Whether the dialog is shown.
 */
export function CreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const { t } = useTranslation();
	const { data, isLoading, isError } = useAttribution(open);

	const group = (kind: AttributionEntry['kind'], title: string) => {
		const items = (data?.items ?? []).filter((i) => i.kind === kind);
		if (items.length === 0) return null;
		return (
			<div className="space-y-3">
				<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
				<ul className="space-y-3">
					{items.map((i) => (
						<li key={`${i.kind}:${i.id}`} className="text-sm">
							<div className="font-medium text-foreground">
								{i.name} <span className="font-normal text-muted-foreground">· {i.license}</span>
							</div>
							{i.attribution && <p className="text-muted-foreground">{i.attribution}</p>}
							{i.source && <p className="break-all text-xs text-muted-foreground">{i.source}</p>}
						</li>
					))}
				</ul>
			</div>
		);
	};

	return (
		<ModalShell open={open} onOpenChange={onOpenChange} title={t('stickers.credits.title')} description={t('stickers.credits.description')} size="lg">
			{isLoading ? (
				<div className="flex justify-center py-8 text-muted-foreground">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : isError || !data ? (
				<p className="py-6 text-center text-sm text-muted-foreground">{t('stickers.credits.unavailable')}</p>
			) : (
				<div className="max-h-[60vh] space-y-6 overflow-y-auto pe-1">
					{group('emoji_style', t('stickers.credits.emoji'))}
					{group('sticker', t('stickers.credits.stickers'))}
				</div>
			)}
		</ModalShell>
	);
}
