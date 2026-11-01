import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Globe, Camera, X, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FormField } from '@/components/form-field';
import { ModalShell } from '@/components/modal-shell';
import { SettingRow } from '@/components/setting-row';
import { ChannelInitialsAvatar } from '@/components/Avatar';
import { ImageEditor } from './ImageEditor';
import { useAuthStore, useChannelStore } from '@/store/store';
import { apiUploadFile } from '@/api/client';
import { logger } from '@/utils/logger';

interface NewChannelModalProps {
	onClose: () => void;
}

/**
 * "New channel" dialog: name, optional description and avatar, private/public.
 * Direct messages are started from the search dialog (Ctrl/Cmd+K) instead.
 */
export default function NewChannelModal({ onClose }: NewChannelModalProps) {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const createChannel = useChannelStore((state) => state.createChannel);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [isPrivate, setIsPrivate] = useState(true);

	// Avatar State
	const [avatarId, setAvatarId] = useState<string | null>(null);
	const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
	const [showCropModal, setShowCropModal] = useState(false);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [uploadingAvatar, setUploadingAvatar] = useState(false);
	const avatarInputRef = useRef<HTMLInputElement | null>(null);

	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		return () => {
			if (avatarPreviewUrl) {
				URL.revokeObjectURL(avatarPreviewUrl);
			}
		};
	}, [avatarPreviewUrl]);

	const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			setError(t('channel.new.avatar_too_large', { size: 5 }));
			return;
		}
		setCropFile(file);
		setShowCropModal(true);
		e.target.value = '';
	};

	const handleSaveAvatarCrop = async (blob: Blob, mime: string) => {
		setShowCropModal(false);
		setUploadingAvatar(true);
		try {
			const ext = mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1] || 'png';
			const file = new File([blob], `channel_avatar.${ext}`, { type: mime });
			const res = await apiUploadFile(file, mime);
			setAvatarId(res.id);
			setAvatarPreviewUrl(URL.createObjectURL(blob));
		} catch (err) {
			logger.error('Failed to upload channel avatar', { error: String(err) });
			setError(t('channel.new.avatar_upload_failed'));
		} finally {
			setUploadingAvatar(false);
		}
	};

	const handleCreateChannel = async () => {
		setError('');
		if (!name.trim()) {
			setError(t('channel.errors.group_name_required'));
			return;
		}

		setLoading(true);
		try {
			const ch = await createChannel(
				name.trim(),
				[user!.id],
				isPrivate,
				description.trim() || undefined,
				avatarId || undefined,
			);
			setActiveChannel(ch);
			onClose();
		} catch (e: unknown) {
			setError((e as Error).message ?? t('channel.errors.create_failed'));
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<ModalShell
				open
				onOpenChange={(open) => !open && onClose()}
				title={t('search.new_channel')}
				footer={
					<>
						<Button type="button" variant="ghost" onClick={onClose}>
							{t('common.cancel')}
						</Button>
						<Button
							type="button"
							disabled={loading || !name.trim()}
							onClick={handleCreateChannel}
						>
							{loading ? <Loader2 size={16} className="animate-spin" /> : t('channel.create')}
						</Button>
					</>
				}
			>
				<div className="space-y-4">
					<div className="space-y-4">
							{/* Avatar & name */}
							<div className="flex items-center gap-4 py-1">
								<div className="group relative shrink-0">
									<div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-muted">
										{avatarPreviewUrl ? (
											<img
												src={avatarPreviewUrl}
												alt={name || t('channel.new.avatar_alt')}
												className="h-full w-full object-cover"
											/>
										) : (
											<ChannelInitialsAvatar name={name} size={64} />
										)}
									</div>

									<input
										ref={avatarInputRef}
										type="file"
										accept="image/*,.svg"
										className="hidden"
										onChange={handleAvatarFileSelect}
									/>

									<button
										type="button"
										onClick={() => avatarInputRef.current?.click()}
										disabled={uploadingAvatar}
										className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center rounded-full bg-overlay/50 text-[10px] font-medium text-overlay-foreground opacity-0 transition-opacity group-hover:opacity-100"
										title={t('channel.new.upload_avatar')}
									>
										{uploadingAvatar ? (
											<Loader2 size={18} className="animate-spin" />
										) : (
											<>
												<Camera size={18} />
												<span className="mt-0.5 text-[9px] font-semibold">
													{t('channel.new.photo')}
												</span>
											</>
										)}
									</button>

									{avatarPreviewUrl && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												setAvatarId(null);
												setAvatarPreviewUrl(null);
											}}
											className="absolute -end-1 -top-1 cursor-pointer rounded-full bg-destructive p-0.5 text-destructive-foreground hover:opacity-90"
											title={t('channel.new.remove_photo')}
										>
											<X size={12} />
										</button>
									)}
								</div>

								<FormField label={t('channel.group_name_label')} required className="min-w-0 flex-1">
									{(c) => (
										<Input
											{...c}
											placeholder={t('channel.group_name_placeholder')}
											value={name}
											onChange={(e) => setName(e.target.value)}
											autoFocus
											autoComplete="off"
										/>
									)}
								</FormField>
							</div>

							<FormField label={t('channel.new.description_label')}>
								{(c) => (
									<Input
										{...c}
										placeholder={t('channel.new.description_placeholder')}
										value={description}
										onChange={(e) => setDescription(e.target.value)}
										autoComplete="off"
									/>
								)}
							</FormField>

							<div className="rounded-md border border-border bg-muted px-3">
								<SettingRow
									title={
										isPrivate ? t('channel.new.private_title') : t('channel.new.public_title')
									}
									description={
										isPrivate ? t('channel.new.private_desc') : t('channel.new.public_desc')
									}
								>
									<div className="flex items-center gap-3">
										{isPrivate ? (
											<Lock size={18} className="text-destructive" />
										) : (
											<Globe size={18} className="text-success" />
										)}
										<Switch
											checked={isPrivate}
											onCheckedChange={setIsPrivate}
											aria-label={t('channel.new.private_title')}
										/>
									</div>
								</SettingRow>
								<p className="pb-3 text-[11px] italic text-muted-foreground">
									{isPrivate ? t('channel.new.private_note') : t('channel.new.public_note')}
								</p>
							</div>
						</div>

					{error && (
						<div
							role="alert"
							className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
						>
							{error}
						</div>
					)}
				</div>
			</ModalShell>

			{showCropModal && cropFile && (
				<ImageEditor
					open={showCropModal}
					onOpenChange={(open) => setShowCropModal(open)}
					file={cropFile}
					onSave={handleSaveAvatarCrop}
					aspectRatio={1}
					circularCrop={true}
					maxSizeMB={5}
				/>
			)}
		</>
	);
}
