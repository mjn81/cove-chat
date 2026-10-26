import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Palette } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmModal } from '@/components/ConfirmModal';
import { FormField } from '@/components/form-field';
import { ImageEditor } from '@/components/ImageEditor';
import { ProfilePhotoViewerModal } from '@/components/ProfilePhotoViewerModal';
import { useAuthStore } from '@/store/store';
import { logger } from '@/utils/logger';
import { useAvatarGallery } from '../hooks/use-avatar-gallery';
import { usePasswordChange } from '../hooks/use-password-change';
import { useProfileForm } from '../hooks/use-profile-form';
import { BannerColorPicker } from './banner-color-picker';
import { ProfileAvatar, PhotoStrip } from './profile-photos';
import { StatusPicker } from './status-picker';

/** Largest profile photo accepted before cropping. */
const MAX_AVATAR_MB = 5;
const MAX_BIO_LENGTH = 190;

/**
 * Settings "My account" page: profile card (banner, photos, name, status,
 * bio), password change, and account deletion.
 */
export const AccountTab = () => {
	const { t } = useTranslation();
	const user = useAuthStore((s) => s.user);
	const deleteAccount = useAuthStore((s) => s.deleteAccount);

	const profile = useProfileForm();
	const photos = useAvatarGallery();
	const password = usePasswordChange();

	const [showColorPicker, setShowColorPicker] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [showCrop, setShowCrop] = useState(false);
	const [viewerIndex, setViewerIndex] = useState<number | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	if (!user) return null;

	const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
			toast.error(t('errors.image_too_large', { size: MAX_AVATAR_MB }));
			return;
		}
		setCropFile(file);
		setShowCrop(true);
	};

	const handleSave = async () => {
		if (await profile.save()) setShowColorPicker(false);
	};

	const handleReset = () => {
		profile.reset();
		setShowColorPicker(false);
	};

	const handleDeleteAccount = async () => {
		try {
			await deleteAccount();
		} catch (error) {
			logger.error('Failed to delete account', { error: String(error) });
		}
	};

	const openViewer = (index: number) => setViewerIndex(Math.max(0, index));

	return (
		<div className="mx-auto w-full max-w-[500px] pb-8 animate-in fade-in slide-in-from-right-4 duration-300">
			<h2 className="mb-5 text-xl font-bold text-foreground">{t('settings.my_account')}</h2>

			{/* Profile card */}
			<div className="mb-6 overflow-hidden rounded-lg border border-border/50 bg-secondary/50">
				<div
					onClick={() => setShowColorPicker((v) => !v)}
					style={{ backgroundColor: profile.bannerColor || 'hsl(var(--primary))' }}
					className="group relative flex h-28 w-full cursor-pointer select-none items-start justify-end p-2.5 transition-colors"
					title={t('settings.change_banner_color')}
				>
					<div className="flex items-center gap-1.5 rounded-md bg-overlay/40 px-2.5 py-1 text-xs font-semibold text-overlay-foreground opacity-80 transition hover:bg-overlay/60 group-hover:opacity-100">
						<Palette size={13} />
						<span>{t('settings.banner_color')}</span>
					</div>
				</div>

				<div className="flex flex-col gap-4 px-4 pb-4">
					<div className="-mt-11 mb-1 flex items-end justify-between">
						<ProfileAvatar
							userId={user.id}
							primaryId={user.avatar_id}
							isUploading={photos.isUploading}
							onPickFile={() => fileInputRef.current?.click()}
							onView={() => openViewer(photos.gallery.indexOf(user.avatar_id ?? ''))}
							onRemovePrimary={() => user.avatar_id && photos.remove(user.avatar_id)}
						/>
						<input
							type="file"
							ref={fileInputRef}
							className="hidden"
							accept="image/*,.svg"
							onChange={handleFileChosen}
						/>
					</div>

					<PhotoStrip
						photos={photos.gallery}
						primaryId={user.avatar_id}
						onMakePrimary={photos.makePrimary}
						onView={openViewer}
						onDelete={photos.remove}
						onAdd={() => fileInputRef.current?.click()}
					/>

					<div className="flex items-center gap-1.5 text-lg font-bold leading-tight text-foreground">
						{user.username}
						<span className="text-sm font-medium text-muted-foreground">~{user.domain}</span>
					</div>

					{showColorPicker && (
						<BannerColorPicker
							value={profile.bannerColor}
							onChange={profile.setBannerColor}
							onClose={() => setShowColorPicker(false)}
						/>
					)}

					<FormField label={t('settings.username')} error={profile.error ?? undefined}>
						{(c) => (
							<Input
								{...c}
								value={profile.username}
								onChange={(e) => profile.setUsername(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleSave()}
								placeholder={t('account.username_placeholder')}
								className="h-9 text-sm font-medium"
								autoComplete="username"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
							/>
						)}
					</FormField>

					<StatusPicker />

					<div className="space-y-1.5 border-t border-border/40 pt-3">
						<div className="flex items-center justify-between">
							<label
								htmlFor="account-bio"
								className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
							>
								{t('settings.about_me')}
							</label>
							<span dir="ltr" className="font-mono text-[10px] text-muted-foreground/70">
								{profile.customMsg.length} / {MAX_BIO_LENGTH}
							</span>
						</div>
						<Textarea
							id="account-bio"
							value={profile.customMsg}
							maxLength={MAX_BIO_LENGTH}
							onChange={(e) => profile.setCustomMsg(e.target.value)}
							onKeyDown={(e) => {
								if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave();
							}}
							placeholder={t('account.bio_placeholder')}
							className="min-h-[75px] resize-none text-sm leading-relaxed"
						/>
					</div>
				</div>

				{profile.isDirty && (
					<div className="flex items-center justify-between border-t border-border/60 bg-secondary/80 px-5 py-3 animate-in fade-in slide-in-from-top-1 duration-150">
						<span className="text-xs font-semibold text-foreground">{t('settings.unsaved_changes')}</span>
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" onClick={handleReset} disabled={profile.isSaving} className="h-8 px-3 text-xs font-semibold">
								{t('settings.reset')}
							</Button>
							<Button size="sm" onClick={handleSave} disabled={profile.isSaving} className="h-8 gap-1.5 px-4 text-xs font-bold">
								{profile.isSaving ? (
									<>
										<Loader2 size={13} className="animate-spin" />
										<span>{t('account.saving')}</span>
									</>
								) : (
									<span>{t('settings.save_changes')}</span>
								)}
							</Button>
						</div>
					</div>
				)}
			</div>

			{/* Password */}
			<div className="mb-6 rounded-lg border border-border/50 bg-secondary/30 p-4">
				<h3 className="mb-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
					{t('settings.password_change')}
				</h3>
				<div className="grid gap-4">
					<FormField label={t('account.current_password')}>
						{(c) => (
							<Input
								{...c}
								type="password"
								value={password.oldPassword}
								onChange={(e) => password.setOldPassword(e.target.value)}
								placeholder={t('account.enter_current_password')}
								className="h-9 text-sm"
								autoComplete="current-password"
							/>
						)}
					</FormField>
					<FormField label={t('settings.new_password')} error={password.error ?? undefined}>
						{(c) => (
							<div className="flex gap-2">
								<Input
									{...c}
									type="password"
									value={password.newPassword}
									onChange={(e) => password.setNewPassword(e.target.value)}
									placeholder={t('account.enter_new_password')}
									className="h-9 text-sm"
									autoComplete="new-password"
								/>
								<Button
									onClick={password.submit}
									disabled={password.isUpdating || !password.newPassword || !password.oldPassword}
									className="h-9 px-4 text-xs font-bold"
								>
									{password.isUpdating ? <Loader2 size={16} className="animate-spin" /> : t('settings.update_password')}
								</Button>
							</div>
						)}
					</FormField>
				</div>
			</div>

			{/* Account removal */}
			<div className="border-t border-border pt-6">
				<h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-destructive">
					{t('settings.account_removal')}
				</h3>
				<p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t('settings.delete_description')}</p>
				<Button variant="destructive" className="h-9 px-6 font-bold" onClick={() => setShowDeleteConfirm(true)}>
					{t('settings.delete_account')}
				</Button>
				<ConfirmModal
					isOpen={showDeleteConfirm}
					onClose={() => setShowDeleteConfirm(false)}
					onConfirm={handleDeleteAccount}
					title={t('account.delete_title')}
					message={t('account.delete_message')}
					confirmText={t('account.delete_title')}
					variant="danger"
				/>
			</div>

			<ImageEditor
				open={showCrop}
				onOpenChange={setShowCrop}
				file={cropFile}
				onSave={photos.upload}
				aspectRatio={1}
				circularCrop={true}
				maxSizeMB={MAX_AVATAR_MB}
			/>

			<ProfilePhotoViewerModal
				open={viewerIndex !== null}
				onOpenChange={(open) => !open && setViewerIndex(null)}
				photos={photos.gallery}
				initialIndex={viewerIndex ?? 0}
				username={user.username}
			/>
		</div>
	);
};

export default AccountTab;
