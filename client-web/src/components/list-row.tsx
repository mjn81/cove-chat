import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ListRowProps {
	/** Avatar, icon or status indicator shown at the start. */
	leading?: React.ReactNode;
	/** Already-translated or user-provided primary text; truncates. */
	title: React.ReactNode;
	/** Secondary line (last message, role, status); truncates. */
	subtitle?: React.ReactNode;
	/** Badge, timestamp or action buttons shown at the end. */
	trailing?: React.ReactNode;
	/** Makes the whole row a button. Omit for a static row (e.g. one with its own action buttons). */
	onClick?: () => void;
	/** Highlights the row as the current selection (active channel, picked member). */
	selected?: boolean;
	className?: string;
}

/**
 * Standard list item for channels, members, friends, search results and
 * pickers. Same anatomy as Android's `CoveListRow`: leading, title/subtitle,
 * trailing.
 *
 * @example
 * <ListRow leading={<Avatar userId={u.id} />} title={u.username} subtitle={role}
 *   onClick={() => select(u.id)} selected={selectedId === u.id} />
 */
export const ListRow: React.FC<ListRowProps> = ({
	leading,
	title,
	subtitle,
	trailing,
	onClick,
	selected,
	className,
}) => {
	const classes = cn(
		'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start',
		onClick && 'cursor-pointer transition-colors hover:bg-accent',
		selected && 'bg-accent',
		className,
	);
	const content = (
		<>
			{leading && <span className="shrink-0">{leading}</span>}
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-foreground">{title}</span>
				{subtitle && (
					<span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
				)}
			</span>
			{trailing && <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
		</>
	);

	return onClick ? (
		<button type="button" onClick={onClick} aria-pressed={selected} className={classes}>
			{content}
		</button>
	) : (
		<div className={classes}>{content}</div>
	);
};
