import { useTranslation } from 'react-i18next';
import { Camera, Loader2, Maximize2, Plus, Trash2 } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { getFileUrl } from '@/api/client';
import { cn } from '@/lib/utils';
import { MAX_AVATARS } from '../utils/avatar-gallery';

interface ProfileAvatarProps {
	userId: string;
	primaryId?: string;
	isUploading: boolean;
	onPickFile: () => void;
	onView: () => void;
	onRemovePrimary: () => void;
}

/** Large profile avatar with change / view-fullscreen / remove buttons. */
export const ProfileAvatar = ({
	userId,
	primaryId,
	isUploading,
	onPickFile,
	onView,
	onRemovePrimary,
}: ProfileAvatarProps) => {
	const { t } = useTranslation();

	return (
		<div className="group relative">
			<div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-[4px] border-card bg-background">
				<Avatar userId={userId} avatarId={primaryId} size={80} />
				{isUploading && (
					<div className="absolute inset-0 z-10 flex items-center justify-center rounded-full bg-overlay/60">
						<Loader2 size={24} className="animate-spin text-overlay-foreground" />
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={onPickFile}
				className="absolute inset-0 z-20 flex cursor-pointer items-center justify-center rounded-full bg-overlay/40 opacity-0 transition-opacity group-hover:opacity-100"
				title={t('account.change_avatar')}
				aria-label={t('account.change_avatar')}
			>
				<Camera size={20} className="text-overlay-foreground" />
			</button>
			{primaryId && (
				<>
					<button
						type="button"
						onClick={onView}
						className="absolute -end-1 -top-1 z-30 cursor-pointer rounded-full border-2 border-card bg-overlay/70 p-1.5 text-overlay-foreground transition hover:bg-overlay/90"
						title={t('account.view_fullscreen')}
						aria-label={t('account.view_fullscreen')}
					>
						<Maximize2 size={12} />
					</button>
					<button
						type="button"
						onClick={onRemovePrimary}
						className="absolute -bottom-1 -end-1 z-30 cursor-pointer rounded-full border-2 border-card bg-destructive p-1.5 text-destructive-foreground transition hover:bg-destructive/90"
						title={t('account.remove_photo')}
						aria-label={t('account.remove_photo')}
					>
						<Trash2 size={12} />
					</button>
				</>
			)}
		</div>
	);
};

interface PhotoStripProps {
	photos: string[];
	primaryId?: string;
	onMakePrimary: (id: string) => void;
	onView: (index: number) => void;
	onDelete: (id: string) => void;
	onAdd: () => void;
}

/** Row of up to five profile photos: click to make primary, hover for view/delete. */
export const PhotoStrip = ({ photos, primaryId, onMakePrimary, onView, onDelete, onAdd }: PhotoStripProps) => {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col gap-2 border-t border-border/40 pt-1">
			<div className="flex items-center justify-between">
				<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{t('account.photos_count', { count: photos.length, max: MAX_AVATARS })}
				</span>
				<span className="text-[11px] text-muted-foreground">{t('account.click_primary')}</span>
			</div>

			<div className="flex flex-wrap items-center gap-2.5">
				{photos.map((id, idx) => {
					const isPrimary = id === primaryId;
					return (
						<div
							key={id || idx}
							onClick={() => onMakePrimary(id)}
							className={cn(
								'group/photo relative h-12 w-12 cursor-pointer overflow-hidden rounded-full border-2 transition-all',
								isPrimary
									? 'scale-105 border-primary'
									: 'border-border/60 opacity-70 hover:border-border hover:opacity-100',
							)}
							title={isPrimary ? t('account.current_primary') : t('account.set_primary')}
						>
							<img src={getFileUrl(id)} alt={t('account.avatar_alt')} className="h-full w-full object-cover" />
							{isPrimary && (
								<div className="absolute inset-x-0 bottom-0 bg-primary/90 py-0.5 text-center text-[8px] font-bold text-primary-foreground">
									{t('account.active')}
								</div>
							)}
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onView(idx);
								}}
								className="absolute start-0.5 top-0.5 z-10 cursor-pointer rounded-full bg-overlay/70 p-1 text-overlay-foreground opacity-0 transition hover:bg-overlay/90 group-hover/photo:opacity-100"
								title={t('account.view_fullscreen')}
								aria-label={t('account.view_fullscreen')}
							>
								<Maximize2 size={9} />
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onDelete(id);
								}}
								className="absolute end-0.5 top-0.5 z-10 cursor-pointer rounded-full bg-overlay/70 p-1 text-overlay-foreground opacity-0 transition hover:bg-destructive group-hover/photo:opacity-100"
								title={t('account.delete_photo')}
								aria-label={t('account.delete_photo')}
							>
								<Trash2 size={9} />
							</button>
						</div>
					);
				})}

				{photos.length < MAX_AVATARS && (
					<button
						type="button"
						onClick={onAdd}
						className="flex h-12 w-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border-2 border-dashed border-border/80 text-muted-foreground transition hover:border-primary hover:text-primary"
						title={t('account.add_photo', { max: MAX_AVATARS })}
						aria-label={t('account.add_photo', { max: MAX_AVATARS })}
					>
						<Plus size={14} />
						<span className="text-[8px] font-medium">{t('account.add')}</span>
					</button>
				)}
			</div>
		</div>
	);
};
