import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';

import { IconButton } from '@/components/icon-button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isMac } from '@/utils/wails';

interface SidebarActionsProps {
	isCollapsed: boolean;
	onOpenSearch: () => void;
	onNewConversation: () => void;
}

/** Search launcher (Ctrl/Cmd+K) and "new conversation" button under the sidebar header. */
export const SidebarActions = ({
	isCollapsed,
	onOpenSearch,
	onNewConversation,
}: SidebarActionsProps) => {
	const { t } = useTranslation();
	const shortcut = isMac() ? '⌘K' : 'Ctrl+K';

	if (isCollapsed) {
		return (
			<div className="flex w-full shrink-0 flex-col items-center gap-1.5 border-b border-border/40 px-2 py-2.5">
				<TooltipProvider delayDuration={0}>
					<Tooltip>
						<TooltipTrigger asChild>
							<IconButton label={t('sidebar.search_tooltip', { shortcut })} onClick={onOpenSearch}>
								<Search className="h-4 w-4" />
							</IconButton>
						</TooltipTrigger>
						<TooltipContent side="right" className="font-bold">
							{t('sidebar.search_tooltip', { shortcut })}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<IconButton label={t('sidebar.new_conversation')} onClick={onNewConversation}>
								<Plus className="h-4 w-4" />
							</IconButton>
						</TooltipTrigger>
						<TooltipContent side="right" className="font-bold">
							{t('sidebar.new_conversation')}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
		);
	}

	return (
		<div className="flex w-full min-w-0 shrink-0 items-center gap-1.5 px-2.5 pb-2 pt-2.5">
			<button
				type="button"
				onClick={onOpenSearch}
				className="group flex h-8 min-w-0 flex-1 cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md border border-border/40 bg-popover px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
				title={t('sidebar.search_title', { shortcut })}
			>
				<Search className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
				<span className="min-w-0 truncate text-start text-xs">{t('sidebar.search_short')}</span>
				<kbd
					dir="ltr"
					className="pointer-events-none ms-auto hidden h-5 shrink-0 select-none items-center gap-0.5 rounded border border-border/60 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-flex"
				>
					<span className="text-xs leading-none">{isMac() ? '⌘' : 'Ctrl'}</span>
					<span className="leading-none">K</span>
				</kbd>
			</button>
			<IconButton label={t('sidebar.new_conversation')} onClick={onNewConversation}>
				<Plus className="h-4 w-4 shrink-0" />
			</IconButton>
		</div>
	);
};
