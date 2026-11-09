import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Plus, Smile } from 'lucide-react';

import { ImageEditor } from '@/components/ImageEditor';
import EmojiPicker from '@/components/EmojiPicker';
import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { firstEmoji } from '@/domains/emoji/utils/emoji-text';
import { useUploadSticker } from '../hooks/use-packs';
import type { PackQuota } from '../types/stickers.types';
import { packErrorMessage } from '../utils/pack-errors';
import { renderStickerWebp } from '../utils/sticker-image';
import { checkStickerFile, isAnimatedImage, STICKER_MIME_TYPES, type StickerFileProblem } from '../utils/sticker-upload';

/** What the flow needs from an upload mutation; the admin panel passes its own (no user quotas, admin route). */
export interface StickerUploader {
	mutateAsync: (v: { packId: string; file: Blob; emoji?: string; fileName?: string }) => Promise<unknown>;
	isPending: boolean;
}

interface AddStickerFlowProps {
	packId: string;
	/** Upload mutation to use; defaults to the user route. */
	uploader?: StickerUploader;
	stickersInPack: number;
	quota: PackQuota | undefined;
}

/** A file that is ready to upload, with a preview. */
interface Staged {
	blob: Blob;
	name: string;
	previewUrl: string;
}

/**
 * "Add sticker": choose an image, crop it (static images; animated GIF and WebP are sent untouched because cropping
 * would flatten them), scale it to at most 512 px as WebP, pick the emoji it stands for and upload it. Limits and
 * server refusals are shown with a clear message (quota, size, wrong type).
 *
 * @param packId - The pack to add to (owner only).
 * @param stickersInPack - Current sticker count, for the quota pre-check.
 * @param quota - Caps and usage from the pack list.
 */
export function AddStickerFlow({ packId, stickersInPack, quota, uploader }: AddStickerFlowProps) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const [editing, setEditing] = useState<File | null>(null);
	const [staged, setStaged] = useState<Staged | null>(null);
	const [emoji, setEmoji] = useState('');
	const [showPicker, setShowPicker] = useState(false);
	const ownUpload = useUploadSticker();
	const upload: StickerUploader = uploader ?? ownUpload;

	// The preview is an object URL; release it when the staged file changes or the flow closes.
	useEffect(() => {
		return () => {
			if (staged) URL.revokeObjectURL(staged.previewUrl);
		};
	}, [staged]);

	const stage = (blob: Blob, name: string) => {
		setStaged({ blob, name, previewUrl: URL.createObjectURL(blob) });
		setEmoji('');
		setShowPicker(false);
	};

	const onFile = async (file: File | undefined) => {
		if (!file) return;
		const problem: StickerFileProblem | null = checkStickerFile(file, quota, stickersInPack);
		if (problem) {
			toast.error(t(`stickers.problems.${problem}`));
			return;
		}
		const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
		if (isAnimatedImage(head, file.type)) stage(file, file.name);
		else setEditing(file);
	};

	const onCropped = async (blob: Blob) => {
		try {
			stage(await renderStickerWebp(blob, quota?.sticker_max_side ?? 512), 'sticker.webp');
		} catch {
			toast.error(t('stickers.problems.decode'));
		}
	};

	const send = async () => {
		if (!staged) return;
		try {
			await upload.mutateAsync({ packId, file: staged.blob, emoji: firstEmoji(emoji) || undefined, fileName: staged.name });
			setStaged(null);
		} catch (err) {
			toast.error(packErrorMessage(err, t));
		}
	};

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept={STICKER_MIME_TYPES.join(',')}
				className="hidden"
				onChange={(e) => {
					void onFile(e.target.files?.[0]);
					e.target.value = '';
				}}
			/>
			<Button type="button" size="sm" onClick={() => inputRef.current?.click()}>
				<Plus className="h-4 w-4" />
				{t('stickers.manager.add_sticker')}
			</Button>

			<ImageEditor
				open={!!editing}
				onOpenChange={(open) => !open && setEditing(null)}
				file={editing}
				circularCrop={false}
				aspectRatio={1}
				maxSizeMB={4}
				onSave={(blob) => void onCropped(blob)}
			/>

			<ModalShell
				open={!!staged}
				onOpenChange={(open) => !open && !upload.isPending && setStaged(null)}
				title={t('stickers.manager.add_sticker')}
				footer={
					<>
						<Button type="button" variant="ghost" onClick={() => setStaged(null)} disabled={upload.isPending}>
							{t('common.cancel')}
						</Button>
						<Button type="button" onClick={send} disabled={upload.isPending}>
							{upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							{t('stickers.manager.upload')}
						</Button>
					</>
				}
			>
				{staged && (
					<div className="flex flex-col items-center gap-4">
						<img src={staged.previewUrl} alt="" className="h-40 w-40 rounded-md bg-muted/40 object-contain" />
						<div className="flex w-full items-center gap-2">
							<Input
								value={emoji}
								onChange={(e) => setEmoji(e.target.value)}
								placeholder={t('stickers.manager.emoji_placeholder')}
								aria-label={t('stickers.manager.emoji_label')}
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck={false}
								maxLength={16}
							/>
							<Button type="button" variant="outline" size="icon" onClick={() => setShowPicker((v) => !v)} aria-label={t('stickers.manager.pick_emoji')}>
								<Smile className="h-4 w-4" />
							</Button>
						</div>
						{showPicker && (
							<div className="w-full">
								<EmojiPicker
									onSelect={(e) => {
										setEmoji(firstEmoji(e.native));
										setShowPicker(false);
									}}
									onClickOutside={() => setShowPicker(false)}
								/>
							</div>
						)}
						<p className="text-xs text-muted-foreground">{t('stickers.manager.emoji_hint')}</p>
					</div>
				)}
			</ModalShell>
		</>
	);
}
