import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
	/** A `lucide-react` icon element, e.g. `<MessageSquare />`. */
	icon?: React.ReactNode;
	/** Already-translated heading. */
	title: string;
	/** Already-translated explanation. */
	description?: string;
	/** Optional call to action, usually a `Button`. */
	action?: React.ReactNode;
	className?: string;
}

/**
 * Centered placeholder for lists, search results and panels with nothing to
 * show. Mirrors Android's `EmptyState`.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
	icon,
	title,
	description,
	action,
	className,
}) => (
	<div
		className={cn(
			'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
			className,
		)}
	>
		{icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
		<p className="text-sm font-semibold text-foreground">{title}</p>
		{description && <p className="max-w-xs text-xs text-muted-foreground">{description}</p>}
		{action && <div className="pt-2">{action}</div>}
	</div>
);
