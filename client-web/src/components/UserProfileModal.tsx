import React, { useEffect, useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/store';
import { useChannelStore } from '@/store/channels.slice';
import { apiGetUser, getFileUrl } from '@/api/client';
import { Avatar as MinidenticonAvatar } from '@/components/Avatar';
import { ProfilePhotoViewerModal } from '@/components/ProfilePhotoViewerModal';
import { evictStaleAvatars, prewarmAvatars } from '@/lib/avatarCache';
import type { User } from '@/types/api';
import {
	MessageSquare,
	UserPlus,
	UserCheck,
	ShieldAlert,
	ShieldCheck,
	ChevronLeft,
	ChevronRight,
	Loader2,
	Check,
	Clock,
	Maximize2,
} from 'lucide-react';

interface UserProfileModalProps {
	userId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
	userId,
	open,
	onOpenChange,
}) => {
	const currentUser = useAuthStore((state) => state.user);
	const relationships = useAuthStore((state) => state.relationships);
	const incomingRequests = useAuthStore((state) => state.incomingRequests);
	const relationshipAction = useAuthStore((state) => state.relationshipAction);
	const channels = useChannelStore((state) => state.channels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
	const createChannel = useChannelStore((state) => state.createChannel);

	const [targetUser, setTargetUser] = useState<User | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [activePhotoIndex, setActivePhotoIndex] = useState(0);
	const [actionLoading, setActionLoading] = useState(false);
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

	const isMe = currentUser?.id === userId;

	// Determine relationship status from store
	const outgoingRel = relationships.find((r) => r.to_user_id === userId);
	const incomingReq = incomingRequests.find((r) => r.from_user_id === userId);

	let relStatus: 'none' | 'friend' | 'requested' | 'incoming' | 'blocked' = 'none';
	if (outgoingRel?.type === 'friend') relStatus = 'friend';
	else if (outgoingRel?.type === 'requested') relStatus = 'requested';
	else if (outgoingRel?.type === 'blocked') relStatus = 'blocked';
	else if (incomingReq) relStatus = 'incoming';

	useEffect(() => {
		if (!open || !userId) {
			setTargetUser(null);
			setActivePhotoIndex(0);
			setIsFullscreenOpen(false);
			return;
		}

		let isMounted = true;
		setIsLoading(true);
		apiGetUser(userId)
			.then((u) => {
				if (isMounted) {
					// Check if any previously cached avatars for this user were removed
					if (targetUser) {
						const prev = [
							...(targetUser.avatar_ids || []),
							...(targetUser.avatar_id ? [targetUser.avatar_id] : []),
						];
						const curr = [
							...(u.avatar_ids || []),
							...(u.avatar_id ? [u.avatar_id] : []),
						];
						evictStaleAvatars(curr, prev).catch(() => {});
					}
					const active = [
						...(u.avatar_ids || []),
						...(u.avatar_id ? [u.avatar_id] : []),
					];
					prewarmAvatars(active).catch(() => {});

					setTargetUser(u);
					setActivePhotoIndex(0);
				}
			})
			.catch((err) => {
				console.error('Failed to load user profile', err);
			})
			.finally(() => {
				if (isMounted) setIsLoading(false);
			});

		return () => {
			isMounted = false;
		};
	}, [userId, open]);

	const photos: string[] = targetUser?.avatar_ids && targetUser.avatar_ids.length > 0
		? targetUser.avatar_ids
		: (targetUser?.avatar_id ? [targetUser.avatar_id] : []);

	const handlePrevPhoto = (e: React.MouseEvent) => {
		e.stopPropagation();
		setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
	};

	const handleNextPhoto = (e: React.MouseEvent) => {
		e.stopPropagation();
		setActivePhotoIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
	};

	const handleAction = async (action: any) => {
		if (!userId) return;
		setActionLoading(true);
		try {
			await relationshipAction(userId, action);
		} catch (err) {
			console.error(`Failed to execute ${action}`, err);
		} finally {
			setActionLoading(false);
		}
	};

	const handleStartDM = async () => {
		if (!userId) return;
		try {
			const existingDM = channels.find((c) => {
				if (c.name !== '') return false;
				return c.members.includes(userId) && c.members.length === 2;
			});

			if (existingDM) {
				setActiveChannel(existingDM);
			} else {
				const newCh = await createChannel('', [userId], true);
				setActiveChannel(newCh);
			}
			onOpenChange(false);
		} catch (err) {
			console.error('Failed to start DM', err);
		}
	};

	if (!open || !userId) return null;

	const currentPhotoId = photos[activePhotoIndex];

	return (
		<>
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[420px] p-0 bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-3xl overflow-hidden shadow-2xl">
				<DialogTitle className="sr-only">User Profile</DialogTitle>

				{/* Profile Banner */}
				<div
					style={{ backgroundColor: targetUser?.banner_color || '#5865F2' }}
					className="h-28 w-full relative transition-colors"
				/>

				<div className="px-6 pb-6 -mt-14 flex flex-col gap-4">
					{/* Avatar Carousel Container */}
					<div className="flex items-end justify-between">
						<div className="relative group/avatar">
							<div
								onClick={() => currentPhotoId && setIsFullscreenOpen(true)}
								className={`w-24 h-24 rounded-full border-[5px] border-zinc-950 bg-zinc-900 overflow-hidden shadow-xl flex items-center justify-center relative ${
									currentPhotoId ? 'cursor-pointer' : ''
								}`}
								title={currentPhotoId ? 'Click to view full screen' : undefined}
							>
								{isLoading ? (
									<Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
								) : currentPhotoId ? (
									<>
										<img
											src={getFileUrl(currentPhotoId)}
											alt={targetUser?.username}
											className="w-full h-full object-cover transition-opacity duration-200"
										/>
										<div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center rounded-full pointer-events-none">
											<Maximize2 size={20} className="text-white drop-shadow-md" />
										</div>
									</>
								) : (
									<MinidenticonAvatar
										userId={targetUser?.id || ''}
										avatarId={targetUser?.avatar_id}
										size={96}
									/>
								)}

								{/* Telegram Style Photo Carousel Controls */}
								{photos.length > 1 && (
									<>
										<button
											type="button"
											onClick={handlePrevPhoto}
											className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition cursor-pointer z-10"
										>
											<ChevronLeft size={14} />
										</button>
										<button
											type="button"
											onClick={handleNextPhoto}
											className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition cursor-pointer z-10"
										>
											<ChevronRight size={14} />
										</button>
									</>
								)}
							</div>

							{/* Status Indicator */}
							<div
								className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-[3px] border-zinc-950 ${
									targetUser?.status === 'online'
										? 'bg-emerald-500'
										: targetUser?.status === 'away'
										? 'bg-amber-500'
										: 'bg-zinc-600'
								}`}
							/>
						</div>

						{/* Photo dots indicator */}
						{photos.length > 1 && (
							<div className="flex items-center gap-1.5 pb-2">
								{photos.map((_, idx) => (
									<button
										key={idx}
										type="button"
										onClick={() => setActivePhotoIndex(idx)}
										className={`h-1.5 rounded-full transition-all cursor-pointer ${
											activePhotoIndex === idx
												? 'w-4 bg-indigo-500'
												: 'w-1.5 bg-zinc-700 hover:bg-zinc-500'
										}`}
									/>
								))}
							</div>
						)}
					</div>

					{/* Username & Domain */}
					<div className="flex flex-col gap-0.5">
						<div className="text-xl font-bold text-zinc-100 flex items-center gap-2">
							{targetUser?.username || 'User Profile'}
							<span className="text-xs font-medium text-zinc-500">
								~{targetUser?.domain || 'localhost'}
							</span>
						</div>
						{targetUser?.custom_msg && (
							<p className="text-sm text-zinc-400 mt-1 italic">
								"{targetUser.custom_msg}"
							</p>
						)}
					</div>

					{/* Action Buttons */}
					{!isMe && (
						<div className="flex flex-col gap-2 pt-2 border-t border-zinc-800/80">
							<div className="flex items-center gap-2">
								<Button
									type="button"
									onClick={handleStartDM}
									className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl h-10 shadow-lg shadow-indigo-600/20 gap-2 cursor-pointer"
								>
									<MessageSquare size={16} />
									<span>Message</span>
								</Button>

								{relStatus === 'friend' && (
									<Button
										type="button"
										variant="secondary"
										disabled={actionLoading}
										onClick={() => handleAction('remove')}
										className="bg-zinc-800 hover:bg-red-950/40 hover:text-red-400 text-zinc-300 font-semibold rounded-xl h-10 gap-1.5 cursor-pointer border border-zinc-700/60"
										title="Remove Friend"
									>
										<UserCheck size={16} className="text-emerald-400" />
										<span>Friends</span>
									</Button>
								)}

								{relStatus === 'requested' && (
									<Button
										type="button"
										variant="secondary"
										disabled={actionLoading}
										onClick={() => handleAction('cancel')}
										className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold rounded-xl h-10 gap-1.5 cursor-pointer border border-zinc-700/60"
										title="Cancel Friend Request"
									>
										<Clock size={16} className="text-amber-400" />
										<span>Requested</span>
									</Button>
								)}

								{relStatus === 'incoming' && (
									<Button
										type="button"
										disabled={actionLoading}
										onClick={() => handleAction('accept')}
										className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl h-10 gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
									>
										<Check size={16} />
										<span>Accept Request</span>
									</Button>
								)}

								{relStatus === 'none' && (
									<Button
										type="button"
										variant="secondary"
										disabled={actionLoading}
										onClick={() => handleAction('request')}
										className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold rounded-xl h-10 gap-1.5 cursor-pointer border border-zinc-700/60"
									>
										<UserPlus size={16} />
										<span>Add Friend</span>
									</Button>
								)}
							</div>

							{/* Block / Unblock action */}
							<div className="flex justify-end pt-1">
								{relStatus === 'blocked' ? (
									<button
										type="button"
										disabled={actionLoading}
										onClick={() => handleAction('unblock')}
										className="text-xs text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
									>
										<ShieldCheck size={13} />
										<span>Unblock User</span>
									</button>
								) : (
									<button
										type="button"
										disabled={actionLoading}
										onClick={() => handleAction('block')}
										className="text-xs text-zinc-500 hover:text-red-400 flex items-center gap-1 cursor-pointer transition font-medium"
									>
										<ShieldAlert size={13} />
										<span>Block User</span>
									</button>
								)}
							</div>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>

		<ProfilePhotoViewerModal
			open={isFullscreenOpen}
			onOpenChange={setIsFullscreenOpen}
			photos={photos}
			initialIndex={activePhotoIndex}
			username={targetUser?.username}
		/>
		</>
	);
};

export default UserProfileModal;
