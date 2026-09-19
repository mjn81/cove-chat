import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2, Palette, Check, X, Plus, Trash2, Maximize2 } from 'lucide-react';
import { useAuthStore } from '@/store/store';
import { Avatar as MinidenticonAvatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUploadFile, getFileUrl } from '@/api/client';
import { ConfirmModal } from '../ConfirmModal';
import { ImageEditor } from '@/components/ImageEditor';
import { ProfilePhotoViewerModal } from '@/components/ProfilePhotoViewerModal';

const BANNER_PRESETS = [
	'#5865F2', // Blurple
	'#57F287', // Green
	'#FEE75C', // Yellow
	'#ED4245', // Red
	'#EB459E', // Fuchsia
	'#00A8FC', // Cyan
	'#E67E22', // Orange
	'#9B59B6', // Purple
	'#1ABC9C', // Teal
	'#2ECC71', // Emerald
	'#E91E63', // Pink
	'#3498DB', // Blue
	'#34495E', // Navy
	'#4E5058', // Slate
	'#2B2D31', // Dark
	'#1E1F22', // Midnight
];

export const AccountTab = () => {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const updateUser = useAuthStore((state) => state.updateUser);
	const deleteAccount = useAuthStore((state) => state.deleteAccount);

	const [isUploading, setIsUploading] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	// Profile form fields
	const [newUsername, setNewUsername] = useState(user?.username || '');
	const [customMsg, setCustomMsg] = useState(user?.custom_msg || '');
	const [bannerColor, setBannerColor] = useState(user?.banner_color || '#5865F2');
	const [showColorPicker, setShowColorPicker] = useState(false);
	const [usernameError, setUsernameError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

	// Password fields
	const [oldPassword, setOldPassword] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
	const [passwordError, setPasswordError] = useState<string | null>(null);

	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (user) {
			setNewUsername(user.username || '');
			setCustomMsg(user.custom_msg || '');
			setBannerColor(user.banner_color || '#5865F2');
		}
	}, [user?.id, user?.username, user?.custom_msg, user?.banner_color]);

	const isDirty =
		newUsername.trim() !== (user?.username || '') ||
		customMsg !== (user?.custom_msg || '') ||
		bannerColor !== (user?.banner_color || '#5865F2');

	const handleReset = () => {
		setNewUsername(user?.username || '');
		setCustomMsg(user?.custom_msg || '');
		setBannerColor(user?.banner_color || '#5865F2');
		setUsernameError(null);
		setShowColorPicker(false);
	};

	const [selectedFileForCrop, setSelectedFileForCrop] = useState<File | null>(null);
	const [showCropModal, setShowCropModal] = useState(false);
	const [showFullscreenViewer, setShowFullscreenViewer] = useState(false);
	const [fullscreenPhotoIndex, setFullscreenPhotoIndex] = useState(0);

	const galleryPhotos =
		user?.avatar_ids && user.avatar_ids.length > 0
			? user.avatar_ids
			: user?.avatar_id
				? [user.avatar_id]
				: [];

	const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			alert('Image must be under 5MB');
			e.target.value = '';
			return;
		}
		setSelectedFileForCrop(file);
		setShowCropModal(true);
		e.target.value = '';
	};

	const handleSaveCroppedAvatar = async (blob: Blob, mime: string) => {
		setIsUploading(true);
		try {
			const res = await apiUploadFile(blob, mime);
			const fileId = (res as any).id;
			const currentGallery = user?.avatar_ids && user.avatar_ids.length > 0
				? user.avatar_ids
				: (user?.avatar_id ? [user.avatar_id] : []);
			const updatedGallery = [fileId, ...currentGallery.filter((id) => id !== fileId)].slice(0, 5);
			await updateUser({ avatar_id: fileId, avatar_ids: updatedGallery });
		} catch (error) {
			console.error('Failed to upload avatar:', error);
		} finally {
			setIsUploading(false);
		}
	};

	const handleSelectPrimaryAvatar = async (id: string) => {
		if (id === user?.avatar_id) return;
		const currentGallery = user?.avatar_ids || [];
		const updated = [id, ...currentGallery.filter((x) => x !== id)];
		await updateUser({ avatar_id: id, avatar_ids: updated });
	};

	const handleDeleteGalleryAvatar = async (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		const currentGallery =
			user?.avatar_ids && user.avatar_ids.length > 0
				? user.avatar_ids
				: user?.avatar_id
					? [user.avatar_id]
					: [];
		const filtered = currentGallery.filter((x) => x !== id);
		const newPrimary =
			user?.avatar_id === id ? filtered[0] || '' : user?.avatar_id || '';
		await updateUser({ avatar_id: newPrimary, avatar_ids: filtered });
	};

	const handleDeleteCurrentAvatar = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!user?.avatar_id) return;
		const currentGallery =
			user?.avatar_ids && user.avatar_ids.length > 0
				? user.avatar_ids
				: [user.avatar_id];
		const filtered = currentGallery.filter((x) => x !== user.avatar_id);
		const newPrimary = filtered[0] || '';
		await updateUser({ avatar_id: newPrimary, avatar_ids: filtered });
	};

	const handleSaveAll = async () => {
		const trimmed = newUsername.trim();
		if (!trimmed) {
			setUsernameError('Username cannot be empty');
			return;
		}
		if (trimmed.length < 3) {
			setUsernameError('Username must be at least 3 characters');
			return;
		}
		setUsernameError(null);
		setIsSaving(true);
		try {
			const payload: {
				username?: string;
				custom_msg?: string;
				banner_color?: string;
			} = {};

			if (trimmed !== user?.username) {
				payload.username = trimmed;
			}
			if (customMsg !== (user?.custom_msg || '')) {
				payload.custom_msg = customMsg;
			}
			if (bannerColor !== (user?.banner_color || '#5865F2')) {
				payload.banner_color = bannerColor;
			}

			if (Object.keys(payload).length > 0) {
				await updateUser(payload);
			}
			setShowColorPicker(false);
		} catch (error: any) {
			console.error('Failed to update profile:', error);
			if (error.message === 'username taken') {
				setUsernameError(t('auth.errors.username_taken'));
			} else {
				setUsernameError(error.message || 'Failed to update profile');
			}
		} finally {
			setIsSaving(false);
		}
	};

	const handleUpdatePassword = async () => {
		if (!newPassword || !oldPassword) {
			setPasswordError('Both current and new passwords are required');
			return;
		}
		if (newPassword.length < 8) {
			setPasswordError(t('auth.errors.password_length'));
			return;
		}
		setPasswordError(null);
		setIsUpdatingPassword(true);
		try {
			await updateUser({
				password: newPassword,
				old_password: oldPassword,
			});
			setNewPassword('');
			setOldPassword('');
		} catch (err: any) {
			console.error('Password update failed:', err);
			if (err.message === 'invalid current password') {
				setPasswordError('Incorrect current password');
			} else {
				setPasswordError(err.message || 'Failed to update password');
			}
		} finally {
			setIsUpdatingPassword(false);
		}
	};

	const handleDeleteAccount = async () => {
		try {
			await deleteAccount();
		} catch (error) {
			console.error('Failed to delete account:', error);
		}
	};

	if (!user) return null;

	return (
		<div className="w-full max-w-[500px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300 pb-8">
			<h2 className="text-xl font-bold text-foreground mb-5">
				{t('settings.my_account')}
			</h2>

			{/* Profile Header Card */}
			<div className="bg-secondary/50 rounded-lg overflow-hidden mb-6 shadow-lg border border-border/50">
				{/* Interactive Banner with Custom Color Picker */}
				<div
					onClick={() => setShowColorPicker(!showColorPicker)}
					style={{ backgroundColor: bannerColor }}
					className="h-28 w-full relative transition-colors cursor-pointer group flex items-start justify-end p-2.5 select-none"
					title={t('settings.change_banner_color')}
				>
					<div className="bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition shadow-sm opacity-80 group-hover:opacity-100 cursor-pointer">
						<Palette size={13} />
						<span>{t('settings.banner_color')}</span>
					</div>
				</div>

				<div className="px-4 pb-4 flex flex-col gap-4">
					{/* Avatar & Display Name */}
					<div className="flex items-end justify-between -mt-11 mb-1">
						<div className="relative group">
							<div className="w-20 h-20 border-[4px] border-card bg-background rounded-full overflow-hidden shadow-lg relative flex items-center justify-center">
								<MinidenticonAvatar
									userId={user?.id || ''}
									avatarId={user?.avatar_id}
									size={80}
								/>
								{isUploading && (
									<div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-full z-10">
										<Loader2 size={24} className="text-white animate-spin" />
									</div>
								)}
							</div>
							<button
								onClick={() => fileInputRef.current?.click()}
								className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full z-20 cursor-pointer"
								title="Change Avatar"
							>
								<Camera size={20} className="text-white" />
							</button>
							{user?.avatar_id && (
								<>
									<button
										type="button"
										onClick={() => {
											const idx = galleryPhotos.findIndex((id) => id === user.avatar_id);
											setFullscreenPhotoIndex(idx >= 0 ? idx : 0);
											setShowFullscreenViewer(true);
										}}
										className="absolute -top-1 -right-1 bg-black/70 hover:bg-black/90 text-white rounded-full p-1.5 shadow-md border-2 border-card z-30 transition cursor-pointer"
										title="View Photo Fullscreen"
									>
										<Maximize2 size={12} />
									</button>
									<button
										type="button"
										onClick={handleDeleteCurrentAvatar}
										className="absolute -bottom-1 -right-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full p-1.5 shadow-md border-2 border-card z-30 transition cursor-pointer"
										title="Remove Profile Photo"
									>
										<Trash2 size={12} />
									</button>
								</>
							)}
							<input
								type="file"
								ref={fileInputRef}
								className="hidden"
								accept="image/*,.svg"
								onChange={handleFileChosen}
							/>
						</div>
					</div>

					{/* Multi-Avatar Gallery Strip (Max 5) */}
					<div className="flex flex-col gap-2 pt-1 border-t border-border/40">
						<div className="flex items-center justify-between">
							<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
								Profile Photos ({user?.avatar_ids?.length || (user?.avatar_id ? 1 : 0)}/5)
							</span>
							<span className="text-[11px] text-muted-foreground">
								Click to set primary
							</span>
						</div>

						<div className="flex items-center gap-2.5 flex-wrap">
							{(user?.avatar_ids && user.avatar_ids.length > 0 ? user.avatar_ids : (user?.avatar_id ? [user.avatar_id] : [])).map((aid, idx) => {
								const isPrimary = aid === user?.avatar_id;
								return (
									<div
										key={aid || idx}
										onClick={() => handleSelectPrimaryAvatar(aid)}
										className={`relative group/photo w-12 h-12 rounded-full overflow-hidden cursor-pointer border-2 transition-all ${
											isPrimary
												? 'border-indigo-500 shadow-md shadow-indigo-500/30 scale-105'
												: 'border-border/60 hover:border-border opacity-70 hover:opacity-100'
										}`}
										title={isPrimary ? 'Current Primary Avatar' : 'Set as Primary Avatar'}
									>
										<img
											src={getFileUrl(aid)}
											alt="Avatar"
											className="w-full h-full object-cover"
										/>
										{isPrimary && (
											<div className="absolute bottom-0 inset-x-0 bg-indigo-600/90 text-[8px] font-bold text-white text-center py-0.2">
												Active
											</div>
										)}
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												setFullscreenPhotoIndex(idx);
												setShowFullscreenViewer(true);
											}}
											className="absolute top-0.5 left-0.5 bg-black/70 hover:bg-black/90 text-white rounded-full p-1 opacity-0 group-hover/photo:opacity-100 transition shadow cursor-pointer z-10"
											title="View photo fullscreen"
										>
											<Maximize2 size={9} />
										</button>
										<button
											type="button"
											onClick={(e) => handleDeleteGalleryAvatar(aid, e)}
											className="absolute top-0.5 right-0.5 bg-black/70 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover/photo:opacity-100 transition shadow cursor-pointer z-10"
											title="Delete photo"
										>
											<Trash2 size={9} />
										</button>
									</div>
								);
							})}

							{(!user?.avatar_ids || user.avatar_ids.length < 5) && (
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="w-12 h-12 rounded-full border-2 border-dashed border-border/80 hover:border-indigo-500 hover:text-indigo-400 text-muted-foreground flex flex-col items-center justify-center gap-0.5 transition cursor-pointer"
									title="Add profile photo (max 5)"
								>
									<Plus size={14} />
									<span className="text-[8px] font-medium">Add</span>
								</button>
							)}
						</div>
					</div>

					<div className="flex flex-col gap-0.5">
						<div className="text-lg font-bold text-foreground flex items-center gap-1.5 leading-tight">
							{user?.username}
							<span className="text-muted-foreground font-medium text-sm">
								~{user?.domain}
							</span>
						</div>
					</div>

					{/* Custom Banner Color Picker Popover */}
					{showColorPicker && (
						<div className="p-3 bg-card rounded-lg border border-border shadow-xl animate-in fade-in zoom-in-95 duration-150">
							<div className="flex items-center justify-between mb-2.5">
								<span className="text-xs font-bold text-foreground">
									{t('settings.change_banner_color')}
								</span>
								<button
									onClick={(e) => {
										e.stopPropagation();
										setShowColorPicker(false);
									}}
									className="text-muted-foreground hover:text-foreground text-xs p-1 rounded hover:bg-accent cursor-pointer"
								>
									<X size={14} />
								</button>
							</div>

							{/* 16 Cross-Platform Swatches */}
							<div className="grid grid-cols-8 gap-2 mb-3">
								{BANNER_PRESETS.map((color) => {
									const isChosen = bannerColor.toLowerCase() === color.toLowerCase();
									return (
										<button
											key={color}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												setBannerColor(color);
											}}
											style={{ backgroundColor: color }}
											className={`w-7 h-7 rounded-full transition-transform hover:scale-110 flex items-center justify-center cursor-pointer shadow-sm border ${
												isChosen ? 'ring-2 ring-foreground scale-105' : 'border-black/10'
											}`}
										>
											{isChosen && <Check size={13} className="text-white drop-shadow" />}
										</button>
									);
								})}
							</div>

							{/* Simple Hex Input (100% unified across all OSes) */}
							<div className="flex items-center gap-2 pt-2 border-t border-border/50">
								<div
									className="w-7 h-7 rounded-md border border-border shrink-0 shadow-sm"
									style={{ backgroundColor: bannerColor }}
								/>
								<div className="flex items-center bg-background rounded-md px-2 py-1 flex-1 border border-border text-xs">
									<span className="text-muted-foreground font-mono mr-1">#</span>
									<input
										type="text"
										maxLength={6}
										value={bannerColor.replace('#', '')}
										onChange={(e) => {
											const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
											if (val.length <= 6) {
												setBannerColor('#' + val);
											}
										}}
										placeholder="5865F2"
										className="bg-transparent border-none outline-none font-mono text-xs w-full text-foreground uppercase"
									/>
								</div>
							</div>
						</div>
					)}

					{/* Username - Direct clean input */}
					<div className="space-y-1.5">
						<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
							{t('settings.username')}
						</label>
						<div className="relative">
							<Input
								value={newUsername}
								onChange={(e) => {
									setNewUsername(e.target.value);
									setUsernameError(null);
								}}
								onKeyDown={(e) => e.key === 'Enter' && handleSaveAll()}
								placeholder="Username"
								className={`h-9 bg-background text-foreground text-sm font-medium border border-border focus-visible:ring-1 ${
									usernameError
										? 'border-destructive ring-1 ring-destructive'
										: 'focus-visible:ring-primary'
								}`}
							/>
						</div>
						{usernameError && (
							<p className="text-[11px] text-destructive font-bold animate-in fade-in slide-in-from-top-1">
								{usernameError}
							</p>
						)}
					</div>

					{/* Online Status */}
					<div className="pt-3 border-t border-border/40">
						<div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
							Online Status
						</div>
						<div className="flex gap-2">
							{[
								{ id: 'auto', color: 'bg-blue-500', label: 'Auto' },
								{ id: 'online', color: 'bg-green-500', label: 'Online' },
								{ id: 'away', color: 'bg-yellow-500', label: 'Idle' },
								{ id: 'dnd', color: 'bg-red-500', label: 'Do Not Disturb' },
								{ id: 'offline', color: 'bg-gray-500', label: 'Invisible' },
							].map((s) => {
								const isSelected = (user?.status_preference || 'auto') === s.id;
								return (
									<button
										key={s.id}
										disabled={isUpdatingStatus}
										onClick={async () => {
											setIsUpdatingStatus(true);
											try {
												await updateUser({ status_preference: s.id });
											} finally {
												setIsUpdatingStatus(false);
											}
										}}
										className={`group relative flex items-center justify-center w-8 h-8 rounded-md transition-all cursor-pointer ${
											isSelected
												? 'bg-primary/20 ring-1 ring-primary'
												: 'bg-secondary/40 hover:bg-secondary/60'
										} ${isUpdatingStatus ? 'opacity-50 cursor-not-allowed' : ''}`}
										title={s.label}
									>
										{s.id === 'auto' ? (
											<span className="text-[10px] font-bold text-blue-500">A</span>
										) : (
											<div className={`w-3 h-3 rounded-full ${s.color}`} />
										)}
										<div className="absolute bottom-full mb-2 px-2 py-1 bg-popover text-popover-foreground text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-border">
											{s.label}
										</div>
									</button>
								);
							})}
						</div>
					</div>

					{/* About Me / Bio */}
					<div className="pt-3 border-t border-border/40 space-y-1.5">
						<div className="flex items-center justify-between">
							<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
								{t('settings.about_me')}
							</label>
							<span className="text-[10px] text-muted-foreground/70 font-mono">
								{customMsg.length} / 190
							</span>
						</div>
						<textarea
							value={customMsg}
							maxLength={190}
							onChange={(e) => setCustomMsg(e.target.value)}
							onKeyDown={(e) => {
								if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
									handleSaveAll();
								}
							}}
							placeholder="Tell us about yourself..."
							className="w-full bg-background border border-border rounded-md p-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[75px] resize-none leading-relaxed transition"
						/>
					</div>
				</div>

				{/* Docked Card Footer for Unsaved Changes */}
				{isDirty && (
					<div className="px-5 py-3 bg-secondary/80 border-t border-border/60 flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-150">
						<span className="text-xs font-semibold text-foreground">
							{t('settings.unsaved_changes')}
						</span>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={handleReset}
								disabled={isSaving}
								className="h-8 px-3 text-xs font-semibold hover:bg-accent cursor-pointer text-foreground"
							>
								{t('settings.reset')}
							</Button>
							<Button
								size="sm"
								onClick={handleSaveAll}
								disabled={isSaving}
								className="h-8 px-4 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer flex items-center gap-1.5"
							>
								{isSaving ? (
									<>
										<Loader2 size={13} className="animate-spin" />
										<span>Saving...</span>
									</>
								) : (
									<span>{t('settings.save_changes')}</span>
								)}
							</Button>
						</div>
					</div>
				)}
			</div>

			{/* Password Change Section */}
			<div className="bg-secondary/30 rounded-lg p-4 mb-6 border border-border/50">
				<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-4">
					{t('settings.password_change')}
				</h3>
				<div className="space-y-4">
					<div className="grid gap-4">
						<div className="grid gap-1.5">
							<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
								Current Password
							</label>
							<Input
								type="password"
								value={oldPassword}
								onChange={(e) => {
									setOldPassword(e.target.value);
									setPasswordError(null);
								}}
								placeholder="Enter current password"
								className="bg-background border border-border text-foreground h-9 text-sm"
							/>
						</div>
						<div className="grid gap-1.5">
							<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
								{t('settings.new_password')}
							</label>
							<div className="flex gap-2">
								<Input
									type="password"
									value={newPassword}
									onChange={(e) => {
										setNewPassword(e.target.value);
										setPasswordError(null);
									}}
									placeholder="Enter new password"
									className="bg-background border border-border text-foreground h-9 text-sm"
								/>
								<Button
									onClick={handleUpdatePassword}
									disabled={isUpdatingPassword || !newPassword || !oldPassword}
									className="h-9 px-4 text-xs font-bold cursor-pointer"
								>
									{isUpdatingPassword ? (
										<Loader2 size={16} className="animate-spin" />
									) : (
										t('settings.update_password')
									)}
								</Button>
							</div>
						</div>
						{passwordError && (
							<p className="text-[10px] text-destructive font-bold animate-in fade-in slide-in-from-top-1">
								{passwordError}
							</p>
						)}
					</div>
				</div>
			</div>

			{/* Account Removal Section */}
			<div className="pt-6 border-t border-border">
				<h3 className="text-[11px] font-bold text-destructive uppercase tracking-wider mb-3">
					{t('settings.account_removal')}
				</h3>
				<p className="text-xs text-muted-foreground mb-4 leading-relaxed">
					{t('settings.delete_description')}
				</p>

				<Button
					variant="destructive"
					className="font-bold h-9 px-6 transition-all cursor-pointer"
					onClick={() => setShowDeleteConfirm(true)}
				>
					{t('settings.delete_account')}
				</Button>

				<ConfirmModal
					isOpen={showDeleteConfirm}
					onClose={() => setShowDeleteConfirm(false)}
					onConfirm={handleDeleteAccount}
					title="Delete Account"
					message="Are you absolutely sure you want to delete your account? This will permanently remove your profile, channels you own, and all your messages. This action is irreversible."
					confirmText="Delete Account"
					variant="danger"
				/>
			</div>

			<ImageEditor
				open={showCropModal}
				onOpenChange={setShowCropModal}
				file={selectedFileForCrop}
				onSave={handleSaveCroppedAvatar}
				aspectRatio={1}
				circularCrop={true}
				maxSizeMB={5}
			/>

			<ProfilePhotoViewerModal
				open={showFullscreenViewer}
				onOpenChange={setShowFullscreenViewer}
				photos={galleryPhotos}
				initialIndex={fullscreenPhotoIndex}
				username={user?.username}
			/>
		</div>
	);
};

export default AccountTab;
