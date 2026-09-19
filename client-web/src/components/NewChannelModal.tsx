import { useState, useEffect, useRef } from 'react';
import { useUserSearch } from '@/hooks/useUsers';
import { useAuthStore, useChannelStore } from '@/store/store';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageSquare, Hash, Search, Lock, Globe, Camera, X, Loader2 } from 'lucide-react';
import { Avatar as MinidenticonAvatar, ChannelInitialsAvatar } from '@/components/Avatar';
import { ImageEditor } from './ImageEditor';
import { apiUploadFile } from '@/api/client';

interface NewChannelModalProps {
	initialTab?: 'dm' | 'channel';
	onClose: () => void;
}

export default function NewChannelModal({
	initialTab = 'dm',
	onClose,
}: NewChannelModalProps) {
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
			setError('Channel avatar must be under 5MB');
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
			console.error('Failed to upload channel avatar:', err);
			setError('Failed to upload channel avatar');
		} finally {
			setUploadingAvatar(false);
		}
	};

	// DM Search state
	const [searchQuery, setSearchQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');

	useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedQuery(searchQuery.trim());
		}, 300);
		return () => clearTimeout(handler);
	}, [searchQuery]);

	const { data: searchResults = [], isFetching: isSearching } = useUserSearch(
		debouncedQuery,
		user?.username,
	);

	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	const handleCreateChannel = async () => {
		setError('');
		if (!name.trim()) {
			setError('Channel name is required');
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
			setError((e as Error).message ?? 'Failed to create channel');
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
			setError((e as Error).message ?? 'Failed to start direct message');
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="bg-background border border-border text-foreground sm:max-w-[560px] md:max-w-[600px] p-0 overflow-hidden shadow-2xl">
				<div className="p-6">
					<DialogHeader>
						<DialogTitle className="text-xl font-bold text-foreground text-center mb-2">
							New Conversation
						</DialogTitle>
					</DialogHeader>

					<div className="flex gap-2 mb-4 bg-secondary p-1 rounded-lg border border-border/50">
						<Button
							variant="ghost"
							className={`flex-1 flex gap-2 items-center h-9 transition-colors rounded-md ${mode === 'dm' ? 'bg-primary text-primary-foreground hover:bg-primary' : 'bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
							onClick={() => setMode('dm')}
						>
							<MessageSquare size={16} />
							Direct Message
						</Button>
						<Button
							variant="ghost"
							className={`flex-1 flex gap-2 items-center h-9 transition-colors rounded-md ${mode === 'channel' ? 'bg-primary text-primary-foreground hover:bg-primary' : 'bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
							onClick={() => setMode('channel')}
						>
							<Hash size={16} />
							Channel
						</Button>
					</div>

					<div className="space-y-4">
						{mode === 'dm' && (
							<div className="space-y-3">
								<div className="relative">
									<Input
										id="dm-user-search"
										className="bg-popover border-none text-[15px] h-12 pl-10 text-foreground focus-visible:ring-0 rounded-md"
										placeholder="Search for a username..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										autoFocus
										autoComplete="off"
									/>
									<Search className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground" />
								</div>

								{/* Search Results Dropdown */}
								<div className="bg-secondary/50 rounded-md overflow-hidden min-h-[50px] max-h-[220px] overflow-y-auto border border-border/50">
									{isSearching ? (
										<div className="p-4 text-center text-sm text-muted-foreground">
											Searching...
										</div>
									) : searchResults.length > 0 ? (
										<div className="py-2">
											{searchResults.map((u) => (
												<div
													key={u.id}
													onClick={() => handleCreateDM(u.id)}
													className="flex items-center gap-3 px-3 py-2 hover:bg-accent cursor-pointer transition-colors"
												>
													<MinidenticonAvatar
														userId={u.id}
														avatarId={u.avatar_id}
														size={32}
													/>
													<div className="flex flex-col flex-1">
														<span className="text-sm font-bold text-foreground">
															{u.username}
														</span>
													</div>
												</div>
											))}
										</div>
									) : searchQuery.trim() !== '' ? (
										<div className="p-4 text-center text-sm text-muted-foreground">
											No users found.
										</div>
									) : (
										<div className="p-4 text-center text-sm text-muted-foreground">
											Start typing to find someone.
										</div>
									)}
								</div>
							</div>
						)}

						{mode === 'channel' && (
							<div className="space-y-4 pb-2">
								{/* Avatar & Name */}
								<div className="flex items-center gap-4 py-1">
									<div className="relative group shrink-0">
										<div className="w-16 h-16 rounded-full overflow-hidden border-2 border-border/80 bg-secondary flex items-center justify-center shadow-inner">
											{avatarPreviewUrl ? (
												<img
													src={avatarPreviewUrl}
													alt={name || 'Channel Avatar'}
													className="w-full h-full object-cover"
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
											className="absolute inset-0 bg-black/50 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] font-medium backdrop-blur-[1px] cursor-pointer"
											title="Upload channel avatar"
										>
											{uploadingAvatar ? (
												<Loader2 size={18} className="animate-spin" />
											) : (
												<>
													<Camera size={18} />
													<span className="mt-0.5 text-[9px] font-semibold">Photo</span>
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
												className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 shadow-sm hover:opacity-90 transition cursor-pointer"
												title="Remove photo"
											>
												<X size={12} />
											</button>
										)}
									</div>

									<div className="flex-1 space-y-1 min-w-0">
										<Label
											htmlFor="channel-name"
											className="text-xs uppercase font-bold text-muted-foreground"
										>
											Channel Name
										</Label>
										<Input
											id="channel-name"
											className="bg-popover border-none text-[15px] h-10 text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 w-full"
											placeholder="e.g. Design Team"
											value={name}
											onChange={(e) => setName(e.target.value)}
											autoFocus
										/>
									</div>
								</div>

								{/* Description (Optional) */}
								<div className="space-y-1">
									<Label
										htmlFor="channel-description"
										className="text-xs uppercase font-bold text-muted-foreground"
									>
										Description <span className="text-[10px] font-normal lowercase">(optional)</span>
									</Label>
									<Input
										id="channel-description"
										className="bg-popover border-none text-[13px] h-9 text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
										placeholder="What is this channel about?"
										value={description}
										onChange={(e) => setDescription(e.target.value)}
									/>
								</div>

								<div className="bg-secondary/50 border border-border rounded-md overflow-hidden">
									<div
										className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent transition-colors"
										onClick={() => setIsPrivate(!isPrivate)}
									>
										<div className="flex items-center gap-3">
											{isPrivate ? (
												<Lock size={20} className="text-destructive" />
											) : (
												<Globe size={20} className="text-green-500" />
											)}
											<div className="flex flex-col">
												<span className="text-sm font-bold text-foreground">
													{isPrivate ? 'Private Channel' : 'Public Channel'}
												</span>
												<span className="text-xs text-muted-foreground">
													{isPrivate
														? 'Only invited members can find and join.'
														: 'Anyone can find and join this channel.'}
												</span>
											</div>
										</div>
										<div
											className={`w-10 h-5 rounded-full relative transition-colors ${isPrivate ? 'bg-primary' : 'bg-muted-foreground/30'}`}
										>
											<div
												className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isPrivate ? 'right-1' : 'left-1'}`}
											/>
										</div>
									</div>
									<div className="px-3 pb-3">
										<p className="text-[11px] text-muted-foreground bg-popover/50 p-2 rounded italic">
											{isPrivate
												? 'Note: This channel will not appear in the discoverable "Explore" list.'
												: 'Note: This channel will be visible to everyone on the server via search.'}
										</p>
									</div>
								</div>
							</div>
						)}

						{error && (
							<div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20 mt-2">
								{error}
							</div>
						)}
					</div>
				</div>

				<div
					className={`p-4 bg-secondary border-t border-border flex justify-end gap-3 ${mode === 'dm' ? 'hidden' : ''}`}
				>
					<Button
						variant="link"
						className="text-muted-foreground hover:text-foreground"
						onClick={onClose}
					>
						Cancel
					</Button>
					<Button
						disabled={loading || (mode === 'channel' && !name.trim())}
						onClick={handleCreateChannel}
						className="bg-primary hover:opacity-90 text-primary-foreground"
					>
						{loading ? <span className="spinner" /> : 'Create'}
					</Button>
				</div>

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
			</DialogContent>
		</Dialog>
	);
}
