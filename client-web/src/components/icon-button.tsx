import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const iconButtonVariants = cva('shrink-0 rounded-md p-0', {
	variants: {
		tone: {
			muted: 'text-muted-foreground hover:bg-accent hover:text-foreground',
			destructive:
				'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
			filled: 'bg-primary text-primary-foreground hover:bg-primary/90',
			overlay: 'bg-overlay/60 text-overlay-foreground hover:bg-overlay/80',
		},
		size: {
			sm: 'h-8 w-8',
			md: 'h-9 w-9',
		},
	},
	defaultVariants: { tone: 'muted', size: 'sm' },
});

export interface IconButtonProps
	extends Omit<React.ComponentPropsWithoutRef<typeof Button>, 'size' | 'variant'>,
		VariantProps<typeof iconButtonVariants> {
	/** Accessible name; icon-only controls have no visible text, so this is required. */
	label: string;
}

/**
 * Square icon-only button. Replaces the repeated
 * `h-8 w-8 p-0 text-muted-foreground hover:...` class strings.
 *
 * @param label - Accessible name (also used as the native tooltip).
 * @param tone - `muted` (default), `destructive`, `filled` or `overlay` (over video/images).
 * @param size - `sm` (32px) or `md` (36px).
 * @example
 * <IconButton label={t('chat.search')} onClick={open}><Search /></IconButton>
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	({ label, tone, size, className, children, type = 'button', ...props }, ref) => (
		<Button
			ref={ref}
			type={type}
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			className={cn(iconButtonVariants({ tone, size }), className)}
			{...props}
		>
			{children}
		</Button>
	),
);
IconButton.displayName = 'IconButton';
