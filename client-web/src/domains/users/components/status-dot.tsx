import * as React from 'react';

import { cn } from '@/lib/utils';
import { statusDotClass } from '../utils/status';

export interface StatusDotProps {
	/** Presence as stored on the user / channel member map. */
	status?: string | null;
	/** Positioning and ring colour, e.g. `absolute -bottom-0.5 -end-0.5 border-2 border-secondary`. */
	className?: string;
}

/**
 * Small coloured presence dot. Colour comes from {@link statusDotClass}, so
 * every list in the app shows the same states.
 *
 * @example
 * <div className="relative"><Avatar .../><StatusDot status={status} className="absolute -bottom-0.5 -end-0.5 border-2 border-secondary" /></div>
 */
export const StatusDot: React.FC<StatusDotProps> = ({ status, className }) => (
	<span
		aria-hidden="true"
		className={cn('inline-block h-3 w-3 rounded-full', statusDotClass(status), className)}
	/>
);
