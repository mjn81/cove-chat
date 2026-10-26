import * as React from 'react';

import { Avatar } from '@/components/Avatar';
import { StatusDot } from '@/domains/users/components/status-dot';

interface RelationshipCardProps {
	userId: string;
	avatarId?: string;
	name: string;
	/** Second line under the name (domain, "Pending response", ...). */
	subtitle: string;
	/** Shows a presence dot on the avatar when provided. */
	status?: string | null;
	/** Buttons at the end of the card. */
	actions: React.ReactNode;
}

/** Card for one person in the friends, pending, sent and blocked lists. */
export const RelationshipCard = ({
	userId,
	avatarId,
	name,
	subtitle,
	status,
	actions,
}: RelationshipCardProps) => (
	<div className="group flex items-center justify-between rounded-xl border border-border/60 bg-card/60 p-3 transition hover:border-border">
		<div className="flex min-w-0 items-center gap-3">
			<div className="relative shrink-0">
				<Avatar userId={userId} avatarId={avatarId} size={40} />
				{status !== undefined && (
					<StatusDot status={status} className="absolute bottom-0 end-0 border-2 border-card" />
				)}
			</div>
			<div className="min-w-0">
				<div className="truncate text-sm font-bold text-foreground">{name}</div>
				<div className="truncate text-xs text-muted-foreground">{subtitle}</div>
			</div>
		</div>
		<div className="flex shrink-0 items-center gap-1.5">{actions}</div>
	</div>
);
