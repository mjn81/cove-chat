import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut, Settings, User } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/icon-button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AuthUser } from '@/types/api';
import { normalizeStatus } from '../utils/status';
import { StatusDot } from './status-dot';

interface SidebarUserFooterProps {
	user: AuthUser | null;
	isCollapsed: boolean;
	onViewProfile: (userId: string) => void;
	onOpenSettings: () => void;
	onLogout: () => void;
	/** Rendered above the user controls in the collapsed rail (the voice disconnect button). */
	collapsedExtra?: React.ReactNode;
}

const LOGOUT_ITEM_CLASS =
	'cursor-pointer gap-2 text-destructive hover:text-destructive focus:bg-destructive focus:text-destructive-foreground';

/** Avatar with a presence dot ringed to match the footer background. */
const UserAvatarWithStatus = ({ user, size }: { user: AuthUser | null; size: number }) => (
	<div className="pointer-events-none relative">
		<Avatar userId={user?.id || ''} avatarId={user?.avatar_id} size={size} className="shrink-0" />
		<StatusDot
			status={user?.status}
			className="absolute -bottom-0.5 -end-0.5 z-10 border-2 border-secondary"
		/>
	</div>
);

/**
 * Bottom strip of the left sidebar: current user with presence, profile /
 * settings / log-out. Expanded shows name and status; collapsed is an
 * icon-only rail with tooltips.
 */
export const SidebarUserFooter = ({
	user,
	isCollapsed,
	onViewProfile,
	onOpenSettings,
	onLogout,
	collapsedExtra,
}: SidebarUserFooterProps) => {
	const { t } = useTranslation();
	const statusLabel = t(`status.${normalizeStatus(user?.status)}`);

	const profileItem = (
		<DropdownMenuItem
			onClick={() => user?.id && onViewProfile(user.id)}
			className="cursor-pointer gap-2"
		>
			<User className="pointer-events-none h-4 w-4" />
			<span>{t('sidebar.my_profile')}</span>
		</DropdownMenuItem>
	);
	const logoutItem = (
		<DropdownMenuItem onClick={onLogout} className={LOGOUT_ITEM_CLASS}>
			<LogOut className="pointer-events-none h-4 w-4" />
			<span>{t('sidebar.log_out')}</span>
		</DropdownMenuItem>
	);

	if (isCollapsed) {
		return (
			<div className="relative z-10 flex w-full shrink-0 flex-col items-center gap-2 border-t border-border/50 bg-secondary py-2.5">
				{collapsedExtra}
				<TooltipProvider delayDuration={0}>
					<DropdownMenu>
						<Tooltip>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										className="relative cursor-pointer rounded-md p-0.5 transition-colors hover:bg-accent"
										aria-label={t('sidebar.account_menu')}
									>
										<UserAvatarWithStatus user={user} size={32} />
									</button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<TooltipContent side="right" className="font-bold">
								{user?.username} ({statusLabel})
							</TooltipContent>
						</Tooltip>
						<DropdownMenuContent
							align="start"
							side="right"
							className="ms-2 w-48 border-border bg-popover text-foreground"
						>
							{profileItem}
							<DropdownMenuItem onClick={onOpenSettings} className="cursor-pointer gap-2">
								<Settings className="pointer-events-none h-4 w-4" />
								<span>{t('sidebar.settings')}</span>
							</DropdownMenuItem>
							{logoutItem}
						</DropdownMenuContent>
					</DropdownMenu>

					<Tooltip>
						<TooltipTrigger asChild>
							<IconButton label={t('sidebar.settings')} onClick={onOpenSettings}>
								<Settings className="pointer-events-none h-4 w-4" />
							</IconButton>
						</TooltipTrigger>
						<TooltipContent side="right" className="font-bold">
							{t('sidebar.settings')}
						</TooltipContent>
					</Tooltip>

					<Tooltip>
						<TooltipTrigger asChild>
							<IconButton label={t('sidebar.log_out')} tone="destructive" onClick={onLogout}>
								<LogOut className="pointer-events-none h-4 w-4" />
							</IconButton>
						</TooltipTrigger>
						<TooltipContent side="right" className="font-bold text-destructive">
							{t('sidebar.log_out')}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
		);
	}

	return (
		<div className="relative z-10 flex h-[52px] shrink-0 items-center gap-2 border-t border-border/50 bg-secondary px-2">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<div className="flex h-10 min-w-0 flex-1 cursor-pointer select-none items-center gap-2 rounded-md p-1 transition-colors hover:bg-accent">
						<UserAvatarWithStatus user={user} size={32} />
						<div className="pointer-events-none flex min-w-0 flex-1 select-none flex-col leading-tight">
							<span className="truncate text-[13px] font-bold text-foreground">{user?.username}</span>
							<span className="truncate text-[11px] text-muted-foreground">{statusLabel}</span>
						</div>
					</div>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-48 border-border bg-popover text-foreground">
					{profileItem}
					{logoutItem}
				</DropdownMenuContent>
			</DropdownMenu>

			<IconButton label={t('sidebar.settings')} onClick={onOpenSettings}>
				<Settings className="pointer-events-none h-5 w-5" />
			</IconButton>
		</div>
	);
};
