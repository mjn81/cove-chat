import * as React from 'react';
import { CornerDownLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SearchRowProps {
	leading: React.ReactNode;
	/** Small icon before the title (hash, compass). */
	titleIcon?: React.ReactNode;
	title: React.ReactNode;
	subtitle: React.ReactNode;
	/** Unread badge or action button, shown before the enter hint. */
	trailing?: React.ReactNode;
	/** Keyboard/hover highlight; also reveals the "press enter" hint. */
	selected: boolean;
	onClick: () => void;
	onHover: () => void;
}

/** One result in the conversation search: avatar, title/subtitle, trailing badge or action. */
export const SearchRow = ({
	leading,
	titleIcon,
	title,
	subtitle,
	trailing,
	selected,
	onClick,
	onHover,
}: SearchRowProps) => (
	<div
		onClick={onClick}
		onMouseEnter={onHover}
		className={cn(
			'flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 transition',
			selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
		)}
	>
		<div className="flex min-w-0 items-center gap-3">
			<div className="relative shrink-0">{leading}</div>
			<div className="min-w-0">
				<div className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
					{titleIcon}
					<span className="truncate">{title}</span>
				</div>
				<div className="truncate text-xs text-muted-foreground">{subtitle}</div>
			</div>
		</div>
		<div className="flex shrink-0 items-center gap-2">
			{trailing}
			{selected && <CornerDownLeft className="h-4 w-4 text-muted-foreground/80 rtl:-scale-x-100" />}
		</div>
	</div>
);

/** Small section heading above a group of results. */
export const SearchSectionTitle = ({ children }: { children: React.ReactNode }) => (
	<div className="flex items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
		{children}
	</div>
);

/** Unread-count pill used on conversation rows. */
export const UnreadBadge = ({ count }: { count: number }) => (
	<span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-primary px-1 text-[11px] font-bold text-primary-foreground">
		{count}
	</span>
);

/** A keyboard key cap used in the shortcut footer. */
export const KeyCap = ({ children }: { children: React.ReactNode }) => (
	<kbd className="pointer-events-none flex h-5 select-none items-center justify-center rounded border border-border/60 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
		{children}
	</kbd>
);
