import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { IconButton } from '@/components/icon-button';
import { resolveArrowKey, type TextDirection } from '@/utils/media-viewer';
import { cn } from '@/lib/utils';

export interface MediaViewerPosition {
	/** Zero-based index of the visible item. */
	index: number;
	total: number;
	onSelect: (index: number) => void;
}

export interface MediaViewerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Already-translated title shown in the top bar (and announced to screen readers). */
	title: string;
	/** Optional second line under the title (file size, "2 of 5"). */
	subtitle?: string;
	/** Buttons rendered before the close button, e.g. a download `IconButton` with `tone="overlay"`. */
	actions?: React.ReactNode;
	/** Enables the arrow buttons and the Left/Right keys. */
	onPrev?: () => void;
	onNext?: () => void;
	/** Shows the dot indicator for galleries. */
	position?: MediaViewerPosition;
	/** Optional bar pinned to the bottom (file info, captions). */
	footer?: React.ReactNode;
	/** The photo, video or placeholder; centered and shielded from backdrop clicks. */
	children: React.ReactNode;
}

/**
 * Fullscreen viewer shell for photos and videos: scrim, title bar with actions
 * and close, optional previous/next arrows and dots, keyboard navigation.
 * Clicking the backdrop or pressing Esc closes it. The caller supplies the
 * media itself as `children`.
 *
 * @example
 * <MediaViewer open={open} onOpenChange={setOpen} title={file.name}
 *   actions={<IconButton tone="overlay" size="md" label={t('common.download')} onClick={save}><Download /></IconButton>}>
 *   <img src={url} alt="" className="max-h-[85vh] max-w-[92vw] object-contain" />
 * </MediaViewer>
 */
export const MediaViewer: React.FC<MediaViewerProps> = ({
	open,
	onOpenChange,
	title,
	subtitle,
	actions,
	onPrev,
	onNext,
	position,
	footer,
	children,
}) => {
	const { t } = useTranslation();

	React.useEffect(() => {
		if (!open || (!onPrev && !onNext)) return;
		const onKeyDown = (e: KeyboardEvent) => {
			const dir = document.documentElement.dir === 'rtl' ? 'rtl' : ('ltr' as TextDirection);
			const step = resolveArrowKey(e.key, dir);
			if (step === 'prev' && onPrev) {
				e.preventDefault();
				onPrev();
			} else if (step === 'next' && onNext) {
				e.preventDefault();
				onNext();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onPrev, onNext]);

	// Content spans the whole screen but is click-through; only the controls and
	// the media re-enable pointer events, so a click on empty space closes.
	const stop = (e: React.MouseEvent) => e.stopPropagation();

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay className="z-[100] bg-overlay/95" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="pointer-events-none fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-[101] flex select-none items-center justify-center p-3 text-overlay-foreground outline-none sm:p-6"
					onClick={() => onOpenChange(false)}
				>
					<DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>

					<div
						className="pointer-events-auto absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-3 sm:inset-x-6"
						onClick={stop}
					>
						<div className="flex min-w-0 flex-col">
							<span className="truncate text-sm font-bold sm:text-base" title={title}>
								{title}
							</span>
							{subtitle && (
								<span className="truncate text-xs tabular-nums opacity-70">{subtitle}</span>
							)}
						</div>
						<div className="flex shrink-0 items-center gap-2">
							{actions}
							<DialogPrimitive.Close asChild>
								<IconButton label={t('common.close')} tone="overlay" size="md">
									<X size={20} />
								</IconButton>
							</DialogPrimitive.Close>
						</div>
					</div>

					<div className="pointer-events-auto relative flex max-h-full max-w-full items-center justify-center" onClick={stop}>
						{children}
					</div>

					{onPrev && (
						<IconButton
							label={t('media_viewer.previous')}
							tone="overlay"
							size="md"
							onClick={(e) => {
								stop(e);
								onPrev();
							}}
							className="pointer-events-auto absolute start-2 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full sm:start-4"
						>
							<ChevronLeft size={24} className="rtl:rotate-180" />
						</IconButton>
					)}
					{onNext && (
						<IconButton
							label={t('media_viewer.next')}
							tone="overlay"
							size="md"
							onClick={(e) => {
								stop(e);
								onNext();
							}}
							className="pointer-events-auto absolute end-2 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full sm:end-4"
						>
							<ChevronRight size={24} className="rtl:rotate-180" />
						</IconButton>
					)}

					{position && position.total > 1 && (
						<div
							className="pointer-events-auto absolute inset-x-0 bottom-5 z-10 flex items-center justify-center gap-2"
							onClick={stop}
						>
							{Array.from({ length: position.total }, (_, idx) => (
								<button
									key={idx}
									type="button"
									aria-label={t('profile.photo_n', { n: idx + 1 })}
									aria-current={idx === position.index}
									onClick={() => position.onSelect(idx)}
									className={cn(
										'h-2 cursor-pointer rounded-full transition-all',
										idx === position.index
											? 'w-6 bg-primary'
											: 'w-2 bg-overlay-foreground/40 hover:bg-overlay-foreground/70',
									)}
								/>
							))}
						</div>
					)}

					{footer && (
						<div
							className="pointer-events-auto absolute inset-x-0 bottom-4 z-10 flex justify-center px-4 sm:bottom-6"
							onClick={stop}
						>
							{footer}
						</div>
					)}
				</DialogPrimitive.Content>
			</DialogPortal>
		</DialogPrimitive.Root>
	);
};
