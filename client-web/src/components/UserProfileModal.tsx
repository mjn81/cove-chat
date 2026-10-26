import React, { useEffect, useState } from 'react';
import { useOpenDirectMessage } from '@/domains/channels/hooks/use-open-direct-message';
import { getRelationState } from '@/domains/relationships/utils/relation-state';
import { statusDotClass } from '@/domains/users/utils/status';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/icon-button';
import { ModalShell } from '@/components/modal-shell';
import { cn } from '@/lib/utils';
import { logger } from '@/utils/logger';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/store';
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
	const { t } = useTranslation();
	const currentUser = useAuthStore((state) => state.user);
	const relationships = useAuthStore((state) => state.relationships);
	const incomingRequests = useAuthStore((state) => state.incomingRequests);
	const relationshipAction = useAuthStore((state) => state.relationshipAction);
	const openDirectMessage = useOpenDirectMessage();

	const [targetUser, setTargetUser] = useState<User | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [activePhotoIndex, setActivePhotoIndex] = useState(0);
	const [actionLoading, setActionLoading] = useState(false);
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

	const isMe = currentUser?.id === userId;

	const relStatus = userId ? getRelationState(userId, relationships, incomingRequests) : 'none';

	useEffect(() => {
		if (!open || !userId) {
			// Clearing the previous profile when the modal closes.
			// eslint-disable-next-line react-hooks/set-state-in-effect
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
				logger.error('Failed to load user profile', { error: String(err) });
			})
			.finally(() => {
				if (isMounted) setIsLoading(false);
			});

		return () => {
			isMounted = false;
		};
		// targetUser is only read to diff avatars of the previous profile; refetching on its change would loop.
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
			logger.error(`Failed to execute ${action}`, { error: String(err) });
		} finally {
			setActionLoading(false);
		}
	};

	const handleStartDM = async () => {
		if (!userId) return;
		try {
			await openDirectMessage(userId);
			onOpenChange(false);
		} catch (err) {
			logger.error('Failed to start DM', { error: String(err) });
		}
	};

	if (!open || !userId) return null;

	const currentPhotoId = photos[activePhotoIndex];

	return (
		<>
			<ModalShell
				open={open}
				onOpenChange={onOpenChange}
				title={t('profile.title')}
				size="sm"
				chromeless
			>
				{/* Profile Banner: user-chosen colour, falls back to the theme primary */}
				<div
					style={{ backgroundColor: targetUser?.banner_color || 'hsl(var(--primary))' }}
					className="relative h-28 w-full transition-colors"
				/>

				<div className="-mt-14 flex flex-col gap-4 px-6 pb-6">
					{/* Avatar carousel */}
					<div className="flex items-end justify-between">
						<div className="group/avatar relative">
							<div
								onClick={() => currentPhotoId && setIsFullscreenOpen(true)}
								className={cn(
									'relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-[5px] border-card bg-muted',
									currentPhotoId && 'cursor-pointer',
								)}
								title={currentPhotoId ? t('profile.view_fullscreen') : undefined}
							>
								{isLoading ? (
									<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
								) : currentPhotoId ? (
									<>
										<img
											src={getFileUrl(currentPhotoId)}
											alt={targetUser?.username}
											className="h-full w-full object-cover transition-opacity duration-200"
										/>
										<div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-overlay/40 opacity-0 transition-opacity group-hover/avatar:opacity-100">
											<Maximize2 size={20} className="text-overlay-foreground" />
										</div>
									</>
								) : (
									<MinidenticonAvatar
										userId={targetUser?.id || ''}
										avatarId={targetUser?.avatar_id}
										size={96}
									/>
								)}

								{photos.length > 1 && (
									<>
										<IconButton
											label={t('profile.previous_photo')}
											tone="overlay"
											onClick={handlePrevPhoto}
											className="absolute start-1 top-1/2 z-10 h-6 w-6 -translate-y-1/2 rounded-full opacity-0 group-hover/avatar:opacity-100"
										>
											<ChevronLeft size={14} className="rtl:rotate-180" />
										</IconButton>
										<IconButton
											label={t('profile.next_photo')}
											tone="overlay"
											onClick={handleNextPhoto}
											className="absolute end-1 top-1/2 z-10 h-6 w-6 -translate-y-1/2 rounded-full opacity-0 group-hover/avatar:opacity-100"
										>
											<ChevronRight size={14} className="rtl:rotate-180" />
										</IconButton>
									</>
								)}
							</div>

							{/* Status indicator */}
							<div
								className={cn(
									'absolute bottom-1 end-1 h-4 w-4 rounded-full border-[3px] border-card',
									statusDotClass(targetUser?.status),
								)}
							/>
						</div>

						{/* Photo dots indicator */}
						{photos.length > 1 && (
							<div className="flex items-center gap-1.5 pb-2">
								{photos.map((_, idx) => (
									<button
										key={idx}
										type="button"
										aria-label={t('profile.photo_n', { n: idx + 1 })}
										onClick={() => setActivePhotoIndex(idx)}
										className={cn(
											'h-1.5 cursor-pointer rounded-full transition-all',
											activePhotoIndex === idx
												? 'w-4 bg-primary'
												: 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground',
										)}
									/>
								))}
							</div>
						)}
					</div>

					{/* Username & domain */}
					<div className="flex flex-col gap-0.5">
						<div className="flex items-center gap-2 text-xl font-bold text-foreground">
							{targetUser?.username || t('profile.user_fallback')}
							<span className="text-xs font-medium text-muted-foreground">
								~{targetUser?.domain || 'localhost'}
							</span>
						</div>
						{targetUser?.custom_msg && (
							<p className="mt-1 text-sm italic text-muted-foreground">
								"{targetUser.custom_msg}"
							</p>
						)}
					</div>

					{/* Actions */}
					{!isMe && (
						<div className="flex flex-col gap-2 border-t border-border pt-3">
							<div className="flex items-center gap-2">
								<Button type="button" onClick={handleStartDM} className="flex-1">
									<MessageSquare size={16} />
									<span>{t('profile.message')}</span>
								</Button>

								{relStatus === 'friend' && (
									<Button
										type="button"
										variant="secondary"
										disabled={actionLoading}
										onClick={() => handleAction('remove')}
										className="hover:bg-destructive/10 hover:text-destructive"
										title={t('profile.remove_friend')}
									>
										<UserCheck size={16} className="text-success" />
										<span>{t('profile.friends')}</span>
									</Button>
								)}

								{relStatus === 'requested' && (
									<Button
										type="button"
										variant="secondary"
										disabled={actionLoading}
										onClick={() => handleAction('cancel')}
										title={t('profile.cancel_request')}
									>
										<Clock size={16} className="text-warning" />
										<span>{t('profile.requested')}</span>
									</Button>
								)}

								{relStatus === 'incoming' && (
									<Button
										type="button"
										disabled={actionLoading}
										onClick={() => handleAction('accept')}
										className="bg-success text-success-foreground hover:bg-success/90"
									>
										<Check size={16} />
										<span>{t('profile.accept_request')}</span>
									</Button>
								)}

								{relStatus === 'none' && (
									<Button
										type="button"
										variant="secondary"
										disabled={actionLoading}
										onClick={() => handleAction('request')}
									>
										<UserPlus size={16} />
										<span>{t('profile.add_friend')}</span>
									</Button>
								)}
							</div>

							{/* Block / Unblock */}
							<div className="flex justify-end">
								{relStatus === 'blocked' ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={actionLoading}
										onClick={() => handleAction('unblock')}
										className="h-7 gap-1 px-2 text-xs text-primary"
									>
										<ShieldCheck size={13} />
										<span>{t('profile.unblock')}</span>
									</Button>
								) : (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={actionLoading}
										onClick={() => handleAction('block')}
										className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
									>
										<ShieldAlert size={13} />
										<span>{t('profile.block')}</span>
									</Button>
								)}
							</div>
						</div>
					)}
				</div>
			</ModalShell>

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
