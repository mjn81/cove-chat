import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Dialog sizes shared with Android (`CoveDialog`): `sm` confirmations,
 * `md` forms, `lg` settings/lists, `media` full-bleed viewers and recorders.
 */
const modalContentVariants = cva(
	'gap-0 overflow-hidden border-border p-0 shadow-none',
	{
		variants: {
			size: {
				sm: 'max-w-sm rounded-lg bg-card',
				md: 'max-w-md rounded-lg bg-card',
				lg: 'max-w-2xl rounded-lg bg-card',
				media: 'max-w-5xl rounded-lg border-0 bg-overlay/95 text-overlay-foreground',
			},
		},
		defaultVariants: { size: 'md' },
	},
);

export interface ModalShellProps extends VariantProps<typeof modalContentVariants> {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Already-translated title. Always rendered (visually hidden for `media`) for screen readers. */
	title: string;
	/** Optional already-translated subtitle shown under the title. */
	description?: string;
	/** Action row (usually `Button`s); rendered in a bordered footer. */
	footer?: React.ReactNode;
	/** Extra classes for the content panel (avoid restyling colours; use tokens). */
	className?: string;
	/**
	 * Hides the header and drops body padding so content can bring its own
	 * chrome (profile card with banner). The title stays for screen readers.
	 */
	chromeless?: boolean;
	/** Classes for the scrolling body, e.g. to drop the default padding. */
	bodyClassName?: string;
	children: React.ReactNode;
}

/**
 * The one dialog scaffold: flat panel, bordered header / scrolling body /
 * bordered footer, theme tokens only. Build every modal on this instead of
 * restyling `DialogContent` per screen.
 *
 * @example
 * <ModalShell open={open} onOpenChange={setOpen} title={t('channels.create.title')}
 *   footer={<Button onClick={submit}>{t('common.save')}</Button>}>
 *   ...form...
 * </ModalShell>
 */
export const ModalShell: React.FC<ModalShellProps> = ({
	open,
	onOpenChange,
	title,
	description,
	footer,
	size,
	className,
	chromeless,
	bodyClassName,
	children,
}) => {
	const bare = chromeless || size === 'media';

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={cn(modalContentVariants({ size }), className)}>
				<DialogHeader
					className={cn(
						'border-b border-border px-6 py-4 pe-12',
						bare && 'sr-only',
					)}
				>
					<DialogTitle>{title}</DialogTitle>
					{description ? (
						<DialogDescription>{description}</DialogDescription>
					) : (
						<DialogDescription className="sr-only">{title}</DialogDescription>
					)}
				</DialogHeader>
				<div
					className={cn(
						'max-h-[70vh] overflow-y-auto',
						!bare && 'px-6 py-4',
						bodyClassName,
					)}
				>
					{children}
				</div>
				{footer && (
					<DialogFooter className="border-t border-border bg-muted px-6 py-3">
						{footer}
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
};
