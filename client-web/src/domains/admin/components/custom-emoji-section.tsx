import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CustomEmojiImage } from '@/domains/emoji/components/emoji';
import { useCustomEmoji } from '@/domains/emoji/hooks/use-emoji';
import { isValidEmojiName, normalizeEmojiName } from '@/domains/emoji/utils/emoji-text';
import { packErrorMessage } from '@/domains/stickers/utils/pack-errors';
import { MAX_UPLOAD_BYTES } from '@/domains/stickers/utils/sticker-upload';
import { useAdminAddCustomEmoji, useAdminDeleteCustomEmoji } from '../api/use-admin-packs';

/** Image types the server accepts for custom emoji (it checks magic bytes; SVG is refused). */
const EMOJI_TYPES = ['image/png', 'image/webp', 'image/gif'];

/** Upload form and list for the server's custom emoji (`:name:` shortcodes). Admin only; the API enforces it. */
export function CustomEmojiSection() {
	const { t } = useTranslation();
	const { items } = useCustomEmoji();
	const add = useAdminAddCustomEmoji();
	const remove = useAdminDeleteCustomEmoji();
	const [name, setName] = useState('');
	const fileRef = useRef<HTMLInputElement>(null);

	const normalized = normalizeEmojiName(name);
	const nameOk = isValidEmojiName(normalized);

	const onFile = async (file: File | undefined) => {
		if (!file) return;
		if (!EMOJI_TYPES.includes(file.type)) return void toast.error(t('admin.packs.emoji_type'));
		if (file.size > MAX_UPLOAD_BYTES) return void toast.error(t('stickers.problems.too_large'));
		try {
			await add.mutateAsync({ name: normalized, file, fileName: file.name });
			setName('');
			toast.success(t('admin.packs.emoji_added'));
		} catch (err) {
			toast.error(packErrorMessage(err, t));
		}
	};

	return (
		<section className="space-y-4">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{t('admin.packs.emoji_title')}</h3>
				<p className="text-xs text-muted-foreground">{t('admin.packs.emoji_hint')}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					className="w-56"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={t('admin.packs.emoji_name_placeholder')}
					aria-label={t('admin.packs.emoji_name')}
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
					maxLength={34}
				/>
				<input ref={fileRef} type="file" accept={EMOJI_TYPES.join(',')} className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
				<Button type="button" disabled={!nameOk || add.isPending} onClick={() => fileRef.current?.click()}>
					{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
					{t('admin.packs.emoji_upload')}
				</Button>
				{name && !nameOk && <span role="alert" className="text-xs text-destructive">{t('admin.packs.emoji_name_invalid')}</span>}
			</div>
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t('admin.packs.emoji_none')}</p>
			) : (
				<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{items.map((item) => (
						<li key={item.name} className="flex items-center gap-3 rounded-md border border-border bg-card p-2">
							<CustomEmojiImage name={item.name} url={item.url} size={32} />
							<span className="min-w-0 flex-1 truncate text-sm text-foreground">:{item.name}:</span>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="text-destructive"
								disabled={remove.isPending}
								onClick={() => remove.mutate(item.name, { onError: (err) => toast.error(packErrorMessage(err, t)) })}
								aria-label={t('admin.packs.emoji_delete', { name: item.name })}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
