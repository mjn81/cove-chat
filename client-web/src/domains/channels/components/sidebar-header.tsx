import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { IconButton } from '@/components/icon-button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { APP_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

interface SidebarHeaderProps {
	isCollapsed: boolean;
	/** Hides the collapse button on mobile, where the sidebar is a drawer. */
	canCollapse: boolean;
	onToggleCollapse?: () => void;
	appVersion: string;
	/** WebSocket state; drives the connection dot. */
	wsState: string;
}

/** Colour of the connection dot for a given WebSocket state. */
const wsDotClass = (wsState: string) =>
	wsState === 'connected' ? 'bg-success' : wsState === 'connecting' ? 'bg-warning' : 'bg-destructive';

/** Top bar of the left sidebar: app name, version, connection dot and collapse toggle. */
export const SidebarHeader = ({
	isCollapsed,
	canCollapse,
	onToggleCollapse,
	appVersion,
	wsState,
}: SidebarHeaderProps) => {
	const { t } = useTranslation();

	return (
		<div
			className={cn(
				'desktop-drag flex h-12 shrink-0 items-center border-b border-border bg-popover transition-colors',
				isCollapsed ? 'w-full justify-center px-2' : 'px-4 hover:bg-accent/30',
			)}
		>
			{isCollapsed ? (
				<TooltipProvider delayDuration={0}>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={onToggleCollapse}
								className="group relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								aria-label={t('sidebar.expand')}
							>
								<ChevronRight
									size={18}
									className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
								/>
								<span
									className={cn(
										'absolute end-1.5 top-1.5 h-2 w-2 rounded-full border border-secondary',
										wsDotClass(wsState),
									)}
								/>
							</button>
						</TooltipTrigger>
						<TooltipContent side="right" className="font-bold">
							{t('sidebar.expand')}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : (
				<div className="flex min-w-0 flex-1 flex-row items-center justify-between">
					<h2 className="truncate text-[15px] font-bold leading-tight text-foreground">
						{t('sidebar.client_title', { name: APP_NAME })}
					</h2>
					<span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
						{appVersion}
						<span className={cn('h-2 w-2 rounded-full', wsDotClass(wsState))} title={wsState} />
						{canCollapse && onToggleCollapse && (
							<IconButton
								label={t('sidebar.collapse')}
								onClick={onToggleCollapse}
								className="-me-1 h-6 w-6 rounded"
							>
								<ChevronLeft size={16} className="rtl:rotate-180" />
							</IconButton>
						)}
					</span>
				</div>
			)}
		</div>
	);
};
