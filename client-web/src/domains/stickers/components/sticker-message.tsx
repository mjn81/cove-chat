import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePack } from '../hooks/use-packs';
import { parseSticker, stickerFilePath } from '../utils/sticker-message';
import { PackDetailDialog } from './pack-detail-dialog';
import { StickerImage } from './sticker-image';

/** Display size of a sticker in the chat (Telegram shows about this much). */
export const STICKER_SIZE = 168;

/**
 * The body of a `sticker` message: the image large and without a bubble; tapping it opens the pack.
 * Stored stickers load straight from their channel-less file; built-in ones need the pack detail for their
 * versioned URL. A body that cannot be read shows a short notice instead of raw JSON.
 *
 * @param text - Decrypted body of the message (JSON `{pack_id, sticker_id, file_id}`).
 */
export function StickerMessage({ text }: { text?: string }) {
	const { t } = useTranslation();
	const body = parseSticker(text);
	const filePath = body ? stickerFilePath(body) : null;
	// Built-in stickers need the pack for the versioned URL; stored ones do not.
	const { data: pack } = usePack(body && !filePath ? body.pack_id : undefined);
	const [open, setOpen] = useState(false);

	if (!body) return <span className="text-sm text-muted-foreground">{t('stickers.message.unavailable')}</span>;

	const item = pack?.items?.find((i) => i.id === body.sticker_id);
	const path = filePath ?? item?.url;

	return (
		<>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen(true);
				}}
				title={t('stickers.message.open_pack')}
				aria-label={item?.emoji ? `${item.emoji} ${t('stickers.message.sticker')}` : t('stickers.message.sticker')}
				className="block w-fit cursor-pointer rounded-md border-none bg-transparent p-0"
			>
				<StickerImage path={path} alt={item?.emoji ?? t('stickers.message.sticker')} size={STICKER_SIZE} />
			</button>
			<PackDetailDialog packId={open ? body.pack_id : null} onOpenChange={setOpen} />
		</>
	);
}
