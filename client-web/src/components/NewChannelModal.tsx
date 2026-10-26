import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Hash, Search, Lock, Globe, Camera, X, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormField } from '@/components/form-field';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { SettingRow } from '@/components/setting-row';
import { Avatar as MinidenticonAvatar, ChannelInitialsAvatar } from '@/components/Avatar';
import { ImageEditor } from './ImageEditor';
import { useUserSearch } from '@/hooks/useUsers';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuthStore, useChannelStore } from '@/store/store';
import { apiUploadFile } from '@/api/client';
import { logger } from '@/utils/logger';

interface NewChannelModalProps {
	initialTab?: 'dm' | 'channel';
	onClose: () => void;
}

/**
 * "New conversation" dialog: find a user to start a DM, or create a channel
 * (name, optional description and avatar, private/public).
 */
export default function NewChannelModal({
	initialTab = 'dm',
	onClose,
}: NewChannelModalProps) {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const createChannel = useChannelStore((state) => state.createChannel);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const [mode, setMode] = useState<'dm' | 'channel'>(
		initialTab === 'channel' ? 'channel' : 'dm',
	);
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

	// DM search
	const [searchQuery, setSearchQuery] = useState('');
	const debouncedQuery = useDebounce(searchQuery.trim(), 300);
	const { data: searchResults = [], isFetching: isSearching } = useUserSearch(
		debouncedQuery,
		user?.username,
	);

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

	const handleCreateDM = async (targetId: string) => {
		setError('');
		setLoading(true);
		try {
			const ch = await createChannel('', [user!.id, targetId], true);
			setActiveChannel(ch);
			onClose();
		} catch (e: unknown) {
			setError((e as Error).message ?? t('channel.new.dm_failed'));
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<ModalShell
				open
				onOpenChange={(open) => !open && onClose()}
				title={t('channel.new_conversation')}
				footer={
					mode === 'channel' ? (
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
					) : undefined
				}
			>
				<div className="space-y-4">
					<Tabs value={mode} onValueChange={(v) => setMode(v as 'dm' | 'channel')}>
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="dm" className="gap-2">
								<MessageSquare size={16} />
								{t('channel.direct_message')}
							</TabsTrigger>
							<TabsTrigger value="channel" className="gap-2">
								<Hash size={16} />
								{t('channel.group')}
							</TabsTrigger>
						</TabsList>
					</Tabs>

					{mode === 'dm' && (
						<div className="space-y-3">
							<div className="relative">
								<Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
								<Input
									className="h-11 ps-10"
									placeholder={t('channel.new.search_placeholder')}
									aria-label={t('channel.new.search_placeholder')}
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									autoFocus
									autoComplete="off"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
								/>
							</div>

							<div className="max-h-[220px] min-h-[50px] overflow-y-auto rounded-md border border-border bg-muted">
								{isSearching ? (
									<p className="p-4 text-center text-sm text-muted-foreground">
										{t('channel.new.searching')}
									</p>
								) : searchResults.length > 0 ? (
									<div className="space-y-0.5 p-1">
										{searchResults.map((u) => (
											<ListRow
												key={u.id}
												onClick={() => handleCreateDM(u.id)}
												leading={
													<MinidenticonAvatar
														userId={u.id}
														avatarId={u.avatar_id}
														size={32}
													/>
												}
												title={u.username}
											/>
										))}
									</div>
								) : searchQuery.trim() !== '' ? (
									<p className="p-4 text-center text-sm text-muted-foreground">
										{t('channel.new.no_users')}
									</p>
								) : (
									<p className="p-4 text-center text-sm text-muted-foreground">
										{t('channel.new.start_typing')}
									</p>
								)}
							</div>
						</div>
					)}

					{mode === 'channel' && (
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
					)}

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
