import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmojiSettings } from '@/domains/emoji/components/emoji-settings';
import { CreditsDialog } from '@/domains/stickers/components/credits-dialog';
import { MyStickers } from '@/domains/stickers/components/my-stickers';
import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';

/**
 * Settings tab "Emoji and stickers": emoji style and animation switch, the user's sticker packs (only when the
 * server has stickers) and the credits dialog for the art the server ships.
 */
export const EmojiStickersTab = () => {
	const { t } = useTranslation();
	const { supports } = useServerCapabilities();
	const [credits, setCredits] = useState(false);
	const hasArt = supports('emoji_packs') || supports('stickers');

	return (
		<div className="space-y-8">
			<h2 className="text-xl font-bold text-foreground">{t('emoji.settings.tab')}</h2>
			<EmojiSettings />
			{supports('stickers') && (
				<>
					<Separator />
					<MyStickers />
				</>
			)}
			{hasArt && (
				<>
					<Separator />
					<Button type="button" variant="outline" onClick={() => setCredits(true)}>
						<Info className="h-4 w-4" />
						{t('stickers.credits.open')}
					</Button>
					<CreditsDialog open={credits} onOpenChange={setCredits} />
				</>
			)}
		</div>
	);
};
