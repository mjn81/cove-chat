import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
	Trash2,
	Copy,
	Check,
	Lock,
	Globe,
	Search,
	UserPlus,
	X,
	Loader2,
	Camera,
	Users,
	RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/form-field';
import { IconButton } from '@/components/icon-button';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { Avatar, ChannelInitialsAvatar } from '../Avatar';
import { ConfirmModal } from '../ConfirmModal';
import { ImageEditor } from '../ImageEditor';
import { FriendPickerModal } from '../FriendPickerModal';
import { type Channel, type User } from '@/types/api';
import {
	apiUpdateChannel,
	apiDeleteChannel,
	apiAddMember,
	apiUploadFile,
	getFileUrl,
} from '@/api/client';
import { useChannelStore } from '@/store/store';
import { useRegenerateInvite } from '@/domains/channels/hooks/use-invite';
import { useUserSearch } from '@/hooks/useUsers';
import { useDebounce } from '@/hooks/use-debounce';
import { isAdmin as checkAdmin, isOwner as checkOwner } from '@/utils/role';
import { logger } from '@/utils/logger';

interface GroupSettingsModalProps {
	channel: Channel;
	onClose: () => void;
}

/** Minimum characters before the member search hits the server. */
const MIN_SEARCH_LENGTH = 2;

/**
 * Channel settings dialog: avatar, name, privacy, description, adding members,
 * invite link and (owner only) deletion. Non-admins see everything read-only.
 */
export const GroupSettingsModal: React.FC<GroupSettingsModalProps> = ({
	channel,
	onClose,
}) => {
	const { t } = useTranslation();
	const refreshChannels = useChannelStore((state) => state.refreshChannels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
	const [name, setName] = useState(channel.name);
	const [description, setDescription] = useState(channel.description || '');
	const [avatarId, setAvatarId] = useState(channel.avatar_id || '');
	const [isPrivate, setIsPrivate] = useState(channel.is_private);
	const [loading, setLoading] = useState(false);
	const [copied, setCopied] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [showFriendPicker, setShowFriendPicker] = useState(false);
	const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
	// Tracks the link locally so the field updates the moment it is rotated.
	const [inviteLink, setInviteLink] = useState(channel.invite_link);
	const regenerateInvite = useRegenerateInvite();
	const [showCropModal, setShowCropModal] = useState(false);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [uploadingAvatar, setUploadingAvatar] = useState(false);
	const [addMemberNotice, setAddMemberNotice] = useState<string | null>(null);

	// Member addition
	const [searchTerm, setSearchTerm] = useState('');
	const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
	const [isAddingMembers, setIsAddingMembers] = useState(false);
	const debouncedSearch = useDebounce(searchTerm.trim(), 500);
	const { data: searchResults = [], isFetching: isSearching } = useUserSearch(
		debouncedSearch.length >= MIN_SEARCH_LENGTH ? debouncedSearch : '',
		undefined,
	);

	const isAdmin = checkAdmin(channel.user_role);
	const isOwner = checkOwner(channel.user_role);

	// Hide people who are already members or already picked
	const visibleResults =
		searchTerm.trim().length >= MIN_SEARCH_LENGTH
			? searchResults.filter(
					(u) =>
						!channel.members.includes(u.id) && !selectedUsers.some((s) => s.id === u.id),
				)
			: [];

	const handleAddMember = (user: User) => {
		setSelectedUsers((prev) => [...prev, user]);
		setSearchTerm('');
	};

	const removeSelected = (userId: string) => {
		setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
	};

	const avatarInputRef = React.useRef<HTMLInputElement | null>(null);

	const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) {
			toast.error(t('channel.settings.avatar_too_large', { size: 2 }));
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
		} catch (err) {
			logger.error('Failed to upload channel avatar', { error: String(err) });
			toast.error(err instanceof Error ? err.message : t('channel.new.avatar_upload_failed'));
		} finally {
			setUploadingAvatar(false);
		}
	};

	const submitAddMembers = async () => {
		if (selectedUsers.length === 0) return;
		setIsAddingMembers(true);
		setAddMemberNotice(null);
		try {
			const res = await apiAddMember(
				channel.id,
				selectedUsers.map((u) => u.id),
			);
			await refreshChannels();
			setSelectedUsers([]);
			if (res.skipped && res.skipped.length > 0) {
				setAddMemberNotice(
					t('channel.settings.skipped', {
						count: res.skipped.length,
						reasons: res.skipped.map((s) => s.reason).join(', '),
					}),
				);
			}
		} catch (err) {
			logger.error('Failed to add members', { error: String(err) });
			toast.error(err instanceof Error ? err.message : t('channel.settings.add_failed'));
		} finally {
			setIsAddingMembers(false);
		}
	};

	const handleSave = async () => {
		const trimmedName = name.trim();
		if (!trimmedName) return;

		setLoading(true);
		try {
			await apiUpdateChannel(channel.id, {
				name: trimmedName,
				description: description.trim(),
				avatar_id: avatarId,
				is_private: isPrivate,
			});
			await refreshChannels();
			onClose();
		} catch (err) {
			logger.error('Failed to update channel', { error: String(err) });
			toast.error(err instanceof Error ? err.message : t('channel.settings.save_failed'));
		} finally {
			setLoading(false);
		}
	};

	const handleDelete = async () => {
		setLoading(true);
		try {
			await apiDeleteChannel(channel.id);
			setActiveChannel(null);
			await refreshChannels();
			onClose();
		} catch (err) {
			logger.error('Failed to delete channel', { error: String(err) });
			toast.error(err instanceof Error ? err.message : t('channel.settings.delete_failed'));
		} finally {
			setLoading(false);
		}
	};

	const fullInviteLink = `${window.location.origin}/join/${inviteLink}`;

	const handleRegenerate = async () => {
		try {
			const updated = await regenerateInvite.mutateAsync(channel.id);
			setInviteLink(updated.invite_link);
			await refreshChannels();
			toast.success(t('channel.settings.regenerated'));
		} catch (err) {
			logger.error('Failed to regenerate invite link', { error: String(err) });
			toast.error(err instanceof Error ? err.message : t('channel.settings.regenerate_failed'));
		}
	};

	const copyLink = () => {
		if (inviteLink) {
			navigator.clipboard.writeText(fullInviteLink);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<>
			<ModalShell
				open
				onOpenChange={(open) => !open && onClose()}
				title={t('channel.settings.title')}
				description={t('channel.settings.subtitle')}
				size="lg"
				footer={
					(isAdmin || isOwner) && (
						<>
							{isOwner && (
								<Button
									type="button"
									variant="ghost"
									className="me-auto gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
									onClick={() => setShowDeleteConfirm(true)}
									disabled={loading}
								>
									<Trash2 size={14} /> {t('channel.settings.delete')}
								</Button>
							)}
							{isAdmin && (
								<Button type="button" onClick={handleSave} disabled={loading || !name.trim()}>
									{loading ? t('channel.settings.saving') : t('channel.settings.save')}
								</Button>
							)}
						</>
					)
				}
			>
				<div className="space-y-6">
					{/* Avatar & summary */}
					<div className="flex flex-col items-center gap-5 rounded-md border border-border bg-muted p-3 sm:flex-row">
						<div className="group relative shrink-0">
							<div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-background">
								{avatarId ? (
									<img
										src={getFileUrl(avatarId)}
										alt={name}
										className="h-full w-full object-cover"
									/>
								) : (
									<ChannelInitialsAvatar id={channel.id} name={name} size={80} />
								)}
							</div>

							{isAdmin && (
								<>
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
										className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center rounded-full bg-overlay/50 text-[11px] font-medium text-overlay-foreground opacity-0 transition-opacity group-hover:opacity-100"
										title={t('channel.settings.change_avatar')}
									>
										{uploadingAvatar ? (
											<Loader2 size={18} className="animate-spin" />
										) : (
											<>
												<Camera size={18} />
												<span className="mt-0.5 text-[10px]">{t('channel.settings.change')}</span>
											</>
										)}
									</button>
								</>
							)}
						</div>

						<div className="flex-1 space-y-1 text-center sm:text-start">
							<h3 className="text-base font-semibold">{name || t('channel.settings.unnamed')}</h3>
							<p className="text-xs text-muted-foreground">
								{t('channel.settings.avatar_hint', { size: 2 })}
							</p>
							{avatarId && isAdmin && (
								<Button
									type="button"
									variant="link"
									onClick={() => setAvatarId('')}
									className="h-auto p-0 text-xs text-destructive"
								>
									{t('channel.settings.remove_avatar')}
								</Button>
							)}
						</div>
					</div>

					{/* Name & privacy */}
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
						<FormField label={t('channel.group_name_label')} required>
							{(c) => (
								<Input
									{...c}
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t('channel.group_name_placeholder')}
									disabled={!isAdmin}
									autoComplete="off"
								/>
							)}
						</FormField>

						<div className="space-y-1.5">
							<Label>{t('channel.settings.privacy')}</Label>
							<Tabs
								value={isPrivate ? 'private' : 'public'}
								onValueChange={(v) => setIsPrivate(v === 'private')}
							>
								<TabsList className="grid w-full grid-cols-2">
									<TabsTrigger value="private" disabled={!isAdmin} className="gap-2">
										<Lock size={14} /> {t('channel.settings.private')}
									</TabsTrigger>
									<TabsTrigger value="public" disabled={!isAdmin} className="gap-2">
										<Globe size={14} /> {t('channel.settings.public')}
									</TabsTrigger>
								</TabsList>
							</Tabs>
						</div>
					</div>

					<FormField label={t('channel.settings.description')}>
						{(c) => (
							<Textarea
								{...c}
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder={t('channel.new.description_placeholder')}
								rows={3}
								className="resize-none"
								disabled={!isAdmin}
							/>
						)}
					</FormField>

					{/* Add members: admins only */}
					{isAdmin && (
						<>
							<Separator />
							<div className="space-y-3">
								<Label className="flex items-center gap-2">
									<UserPlus size={14} /> {t('channel.settings.add_members')}
								</Label>

								{addMemberNotice && (
									<div
										role="alert"
										className="flex items-center justify-between rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive"
									>
										<span>{addMemberNotice}</span>
										<IconButton
											label={t('common.close')}
											size="sm"
											className="h-6 w-6"
											onClick={() => setAddMemberNotice(null)}
										>
											<X size={13} />
										</IconButton>
									</div>
								)}

								<div className="relative">
									<Search
										className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
										size={16}
									/>
									<Input
										value={searchTerm}
										onChange={(e) => setSearchTerm(e.target.value)}
										placeholder={t('channel.settings.search_users')}
										aria-label={t('channel.settings.search_users')}
										className="ps-10"
										autoComplete="off"
										autoCapitalize="off"
										autoCorrect="off"
										spellCheck={false}
									/>
									{isSearching && (
										<Loader2
											className="absolute end-3 top-1/2 -translate-y-1/2 animate-spin text-primary"
											size={16}
										/>
									)}
								</div>

								{visibleResults.length > 0 && (
									<div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted p-1">
										{visibleResults.map((u) => (
											<ListRow
												key={u.id}
												onClick={() => handleAddMember(u)}
												leading={<Avatar userId={u.id} avatarId={u.avatar_id} size={32} />}
												title={u.username}
												subtitle={`@${u.domain}`}
											/>
										))}
									</div>
								)}

								{selectedUsers.length > 0 && (
									<div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted p-2">
										{selectedUsers.map((u) => (
											<div
												key={u.id}
												className="flex items-center gap-2 rounded-md border border-border bg-accent py-1 ps-1 pe-2"
											>
												<Avatar userId={u.id} avatarId={u.avatar_id} size={20} />
												<span className="text-xs font-medium">{u.username}</span>
												<button
													type="button"
													aria-label={t('channel.settings.remove_selected', { name: u.username })}
													onClick={() => removeSelected(u.id)}
													className="cursor-pointer transition-colors hover:text-destructive"
												>
													<X size={14} />
												</button>
											</div>
										))}
										<Button
											type="button"
											size="sm"
											className="ms-auto h-7 gap-1 px-3 text-[11px] font-bold"
											onClick={submitAddMembers}
											disabled={isAddingMembers}
										>
											{isAddingMembers ? (
												<Loader2 size={12} className="animate-spin" />
											) : (
												<UserPlus size={12} />
											)}
											{t('channel.settings.add_selected', { count: selectedUsers.length })}
										</Button>
									</div>
								)}
							</div>
						</>
					)}

					{/* Invite link */}
					{inviteLink && (
						<>
							<Separator />
							<div className="space-y-2">
								<Label>{t('channel.info.invite_link')}</Label>
								<div className="flex gap-2">
									<Input
										readOnly
										dir="ltr"
										value={fullInviteLink}
										aria-label={t('channel.info.invite_link')}
										className="h-9 font-mono text-xs"
									/>
									<Button
										type="button"
										size="icon"
										variant="outline"
										className="h-9 w-9 shrink-0"
										onClick={copyLink}
										title={t('channel.settings.copy_link')}
										aria-label={t('channel.settings.copy_link')}
									>
										{copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
									</Button>
									<Button
										type="button"
										variant="outline"
										className="h-9 shrink-0 gap-1.5 text-xs"
										onClick={() => setShowFriendPicker(true)}
									>
										<Users size={14} /> {t('channel.settings.send_to_friends')}
									</Button>
									{isAdmin && (
										<Button
											type="button"
											variant="outline"
											className="h-9 shrink-0 gap-1.5 text-xs"
											disabled={regenerateInvite.isPending}
											onClick={() => setShowRegenerateConfirm(true)}
										>
											<RefreshCw size={14} /> {t('channel.settings.regenerate_link')}
										</Button>
									)}
								</div>
							</div>
						</>
					)}
				</div>
			</ModalShell>

			<ConfirmModal
				isOpen={showDeleteConfirm}
				onClose={() => setShowDeleteConfirm(false)}
				onConfirm={handleDelete}
				title={t('channel.settings.delete')}
				message={t('channel.settings.delete_message', { name: channel.name })}
				confirmText={t('channel.settings.delete')}
				variant="danger"
			/>

			<ConfirmModal
				isOpen={showRegenerateConfirm}
				onClose={() => setShowRegenerateConfirm(false)}
				onConfirm={handleRegenerate}
				title={t('channel.settings.regenerate_title')}
				message={t('channel.settings.regenerate_message')}
				confirmText={t('channel.settings.regenerate_confirm')}
				variant="danger"
			/>

			{showFriendPicker && (
				<FriendPickerModal
					open={showFriendPicker}
					onOpenChange={setShowFriendPicker}
					channelId={channel.id}
					channelName={channel.name}
					inviteLink={inviteLink}
				/>
			)}

			{showCropModal && (
				<ImageEditor
					open={showCropModal}
					onOpenChange={setShowCropModal}
					file={cropFile}
					onSave={handleSaveAvatarCrop}
					maxSizeMB={2}
				/>
			)}
		</>
	);
};
