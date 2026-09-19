import React, { useState, useEffect } from 'react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from 'lucide-react';
import { type Channel, type User } from '@/types/api';
import {
	apiUpdateChannel,
	apiDeleteChannel,
	apiSearchUsers,
	apiAddMember,
	apiUploadFile,
	getFileUrl,
} from '@/api/client';
import { useChannelStore } from '@/store/store';
import { Avatar, ChannelInitialsAvatar } from '../Avatar';
import { ConfirmModal } from '../ConfirmModal';
import { ImageEditor } from '../ImageEditor';
import { FriendPickerModal } from '../FriendPickerModal';
import { isAdmin as checkAdmin, isOwner as checkOwner } from '@/utils/role';

interface GroupSettingsModalProps {
	channel: Channel;
	onClose: () => void;
}

export const GroupSettingsModal: React.FC<GroupSettingsModalProps> = ({
	channel,
	onClose,
}) => {
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
	const [showCropModal, setShowCropModal] = useState(false);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [uploadingAvatar, setUploadingAvatar] = useState(false);
	const [addMemberNotice, setAddMemberNotice] = useState<string | null>(null);

	// Member Addition State
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState<User[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
	const [isAddingMembers, setIsAddingMembers] = useState(false);

	const isAdmin = checkAdmin(channel.user_role);
	const isOwner = checkOwner(channel.user_role);

	// Search logic
	useEffect(() => {
		if (searchTerm.length < 2) return;

		const delay = setTimeout(async () => {
			setIsSearching(true);
			try {
				const results = await apiSearchUsers(searchTerm);
				// Filter out users who are already in the channel
				const filtered = results.filter((u) => !channel.members.includes(u.id));
				setSearchResults(filtered);
			} catch (err) {
				console.error('Search failed:', err);
			} finally {
				setIsSearching(false);
			}
		}, 500);

		return () => clearTimeout(delay);
	}, [searchTerm, channel.members]);

	// Derived results for the UI
	const visibleResults = searchTerm.length >= 2 ? searchResults : [];

	const handleAddMember = (user: User) => {
		if (selectedUsers.find((u) => u.id === user.id)) return;
		setSelectedUsers([...selectedUsers, user]);
		setSearchTerm('');
		setSearchResults([]);
	};

	const removeSelected = (userId: string) => {
		setSelectedUsers(selectedUsers.filter((u) => u.id !== userId));
	};

	const avatarInputRef = React.useRef<HTMLInputElement | null>(null);

	const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) {
			alert('Channel avatar must be under 2MB');
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
			console.error('Failed to upload channel avatar:', err);
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
					`${res.skipped.length} user(s) could not be added: ${res.skipped.map((s) => s.reason).join(', ')}`,
				);
			}
		} catch (err) {
			console.error('Failed to add members:', err);
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
			console.error('Failed to update channel:', err);
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
			console.error('Failed to delete channel:', err);
		} finally {
			setLoading(false);
		}
	};

	const fullInviteLink = `${window.location.origin}/join/${channel.invite_link}`;

	const copyLink = () => {
		if (channel.invite_link) {
			navigator.clipboard.writeText(fullInviteLink);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="bg-background text-foreground border-border max-w-2xl md:max-w-3xl rounded-xl overflow-y-auto max-h-[90vh]">
				<DialogHeader>
					<DialogTitle className="text-xl font-bold">
						Channel Settings
					</DialogTitle>
					<DialogDescription className="text-muted-foreground text-sm">
						Manage your channel's details and permissions.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Channel Avatar & Basic Details */}
					<div className="flex flex-col sm:flex-row items-center gap-5 p-3 rounded-lg bg-secondary/20 border border-border/40">
						<div className="relative group shrink-0">
							<div className="w-20 h-20 rounded-full overflow-hidden border-2 border-border bg-muted flex items-center justify-center shadow-inner">
								{avatarId ? (
									<img
										src={getFileUrl(avatarId)}
										alt={name}
										className="w-full h-full object-cover"
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
										className="absolute inset-0 bg-black/50 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-[11px] font-medium backdrop-blur-[1px]"
										title="Change channel avatar"
									>
										{uploadingAvatar ? (
											<Loader2 size={18} className="animate-spin" />
										) : (
											<>
												<Camera size={18} />
												<span className="mt-0.5 text-[10px]">Change</span>
											</>
										)}
									</button>
								</>
							)}
						</div>

						<div className="flex-1 text-center sm:text-left space-y-1">
							<h3 className="font-semibold text-base">{name || 'Unnamed Channel'}</h3>
							<p className="text-xs text-muted-foreground">
								Max 2MB. SVG, PNG, JPG supported.
							</p>
							{avatarId && isAdmin && (
								<button
									type="button"
									onClick={() => setAvatarId('')}
									className="text-xs text-destructive hover:underline font-medium pt-1"
								>
									Remove Avatar
								</button>
							)}
						</div>
					</div>

					{/* Group Name & Status */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<div className="space-y-2">
							<Label
								htmlFor="name"
								className="text-xs uppercase font-bold text-muted-foreground tracking-wider"
							>
								Channel Name
							</Label>
							<Input
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Enter group name..."
								className="bg-secondary/50 border-border focus:ring-primary h-10"
								disabled={!isAdmin}
							/>
						</div>

						<div className="space-y-2">
							<Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
								Privacy
							</Label>
							<div className="flex gap-2">
								<Button
									variant={isPrivate ? 'default' : 'outline'}
									className="flex-1 gap-2 h-10 text-xs"
									onClick={() => setIsPrivate(true)}
									disabled={!isAdmin}
								>
									<Lock size={14} /> Private
								</Button>
								<Button
									variant={!isPrivate ? 'default' : 'outline'}
									className="flex-1 gap-2 h-10 text-xs"
									onClick={() => setIsPrivate(false)}
									disabled={!isAdmin}
								>
									<Globe size={14} /> Public
								</Button>
							</div>
						</div>
					</div>

					{/* Channel Description */}
					<div className="space-y-2">
						<Label
							htmlFor="channel-description"
							className="text-xs uppercase font-bold text-muted-foreground tracking-wider"
						>
							Description
						</Label>
						<textarea
							id="channel-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What is this channel about?"
							rows={3}
							className="w-full rounded-md border border-border bg-secondary/50 p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
							disabled={!isAdmin}
						/>
					</div>

					{/* Add Members Section - Admin Only */}
					{isAdmin && (
						<div className="space-y-3 pt-2 border-t border-border/50">
							<Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
								<UserPlus size={14} /> Add Members
							</Label>

							{addMemberNotice && (
								<div className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-lg flex items-center justify-between">
									<span>{addMemberNotice}</span>
									<button
										onClick={() => setAddMemberNotice(null)}
										className="p-1 hover:text-foreground"
									>
										<X size={13} />
									</button>
								</div>
							)}

							<div className="relative">
								<div className="relative">
									<Search
										className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
										size={16}
									/>
									<Input
										value={searchTerm}
										onChange={(e) => setSearchTerm(e.target.value)}
										placeholder="Search by username..."
										className="pl-10 bg-secondary/30 border-border h-10"
									/>
									{isSearching && (
										<Loader2
											className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-primary"
											size={16}
										/>
									)}
								</div>

								{/* Search Results Dropdown */}
								{visibleResults.length > 0 && (
									<div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
										{visibleResults.map((u) => (
											<button
												key={u.id}
												onClick={() => handleAddMember(u)}
												className="w-full flex items-center gap-3 p-2 hover:bg-accent transition-colors border-b last:border-0 border-border/50"
											>
												<Avatar
													userId={u.id}
													avatarId={u.avatar_id}
													size={32}
												/>
												<div className="flex flex-col items-start">
													<span className="text-sm font-bold">
														{u.username}
													</span>
													<span className="text-[10px] text-muted-foreground">
														@{u.domain}
													</span>
												</div>
											</button>
										))}
									</div>
								)}
							</div>

							{/* Selected Users Chips */}
							{selectedUsers.length > 0 && (
								<div className="flex flex-wrap gap-2 p-2 bg-secondary/20 rounded-lg border border-dashed border-border/50">
									{selectedUsers.map((u) => (
										<div
											key={u.id}
											className="flex items-center gap-2 bg-accent/50 pl-1 pr-2 py-1 rounded-md border border-accent"
										>
											<Avatar userId={u.id} avatarId={u.avatar_id} size={20} />
											<span className="text-xs font-medium">{u.username}</span>
											<button
												onClick={() => removeSelected(u.id)}
												className="hover:text-destructive transition-colors"
											>
												<X size={14} />
											</button>
										</div>
									))}
									<Button
										size="sm"
										className="ml-auto h-7 text-[10px] font-bold px-3"
										onClick={submitAddMembers}
										disabled={isAddingMembers}
									>
										{isAddingMembers ? (
											<Loader2 size={12} className="animate-spin mr-1" />
										) : (
											<UserPlus size={12} className="mr-1" />
										)}
										Add {selectedUsers.length} Member
										{selectedUsers.length > 1 ? 's' : ''}
									</Button>
								</div>
							)}
						</div>
					)}

					{/* Join Link */}
					{channel.invite_link && (
						<div className="space-y-2 pt-2 border-t border-border/50">
							<Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
								Invite Link
							</Label>
							<div className="flex gap-2">
								<Input
									readOnly
									value={fullInviteLink}
									className="bg-secondary/30 border-border font-mono text-xs h-9"
								/>
								<Button
									size="icon"
									variant="outline"
									className="h-9 w-9 shrink-0"
									onClick={copyLink}
									title="Copy link"
								>
									{copied ? (
										<Check size={16} className="text-green-500" />
									) : (
										<Copy size={16} />
									)}
								</Button>
								<Button
									variant="outline"
									className="h-9 gap-1.5 text-xs shrink-0"
									onClick={() => setShowFriendPicker(true)}
								>
									<Users size={14} /> Send to Friends
								</Button>
							</div>
						</div>
					)}

					{/* Actions */}
					<div className="pt-4 flex flex-col gap-3">
						{isAdmin && (
							<Button
								onClick={handleSave}
								disabled={loading || !name.trim()}
								className="w-full font-bold h-11"
							>
								{loading ? 'Saving...' : 'Save Settings'}
							</Button>
						)}

						{isOwner && (
							<div className="pt-2">
								<Button
									variant="ghost"
									className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive font-bold gap-2 text-xs"
									onClick={() => setShowDeleteConfirm(true)}
									disabled={loading}
								>
									<Trash2 size={14} /> Delete Channel
								</Button>

								<ConfirmModal
									isOpen={showDeleteConfirm}
									onClose={() => setShowDeleteConfirm(false)}
									onConfirm={handleDelete}
									title="Delete Channel"
									message={`Are you sure you want to delete "${channel.name}"? All messages and data associated with this channel will be permanently removed. This action cannot be undone.`}
									confirmText="Delete Channel"
									variant="danger"
								/>
							</div>
						)}
					</div>
				</div>
			</DialogContent>

			{showFriendPicker && (
				<FriendPickerModal
					open={showFriendPicker}
					onOpenChange={setShowFriendPicker}
					channelId={channel.id}
					channelName={channel.name}
					inviteLink={fullInviteLink}
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
		</Dialog>
	);
};
