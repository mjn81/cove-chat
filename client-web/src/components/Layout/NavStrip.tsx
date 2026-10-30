import React from 'react';
import { LayoutList, MessageCircle, Hash } from 'lucide-react';
import { MacLightsSpacer } from '@/domains/desktop/components/mac-drag-region';
import { isMacDesktop } from '@/domains/desktop/utils/is-mac-desktop';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

export type SidebarTab = 'all' | 'dms' | 'channels';

interface NavStripProps {
	activeTab: SidebarTab;
	onChange: (tab: SidebarTab) => void;
	orientation?: 'vertical' | 'horizontal';
}

const TABS: { id: SidebarTab; icon: React.ElementType; label: string }[] = [
	{ id: 'all', icon: LayoutList, label: 'All' },
	{ id: 'dms', icon: MessageCircle, label: 'Direct Messages' },
	{ id: 'channels', icon: Hash, label: 'Channels' },
];

export function NavStrip({ activeTab, onChange, orientation = 'vertical' }: NavStripProps) {
	const isHorizontal = orientation === 'horizontal';

	return (
		<TooltipProvider delayDuration={150}>
			<div
				className={
					isHorizontal
						? 'flex flex-row items-center justify-around w-full px-2 py-1.5 bg-secondary border-b border-border/50 shrink-0 select-none gap-2'
						: `flex flex-col items-center gap-1 py-3 bg-secondary border-e border-border/50 shrink-0 select-none ${
							// On the macOS desktop app the traffic lights sit at the top of this column, so it is wide enough for them.
							isMacDesktop() ? 'w-[72px]' : 'w-12'
						}`
				}
			>
				{!isHorizontal && <MacLightsSpacer />}
				{TABS.map(({ id, icon: Icon, label }) => (
					<Tooltip key={id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() => onChange(id)}
								className={`
									relative flex items-center justify-center rounded-xl
									transition-all duration-200 cursor-pointer group
									${
										isHorizontal
											? 'flex-1 h-9 gap-1.5 text-xs font-medium'
											: 'w-10 h-10'
									}
									${
										activeTab === id
											? 'bg-primary/15 text-primary'
											: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
									}
								`}
							>
								<Icon size={isHorizontal ? 18 : 20} />
								{isHorizontal && (
									<span className="hidden min-[480px]:inline truncate">{label}</span>
								)}
							</button>
						</TooltipTrigger>
						<TooltipContent side={isHorizontal ? 'bottom' : 'right'} sideOffset={8}>
							{label}
						</TooltipContent>
					</Tooltip>
				))}
			</div>
		</TooltipProvider>
	);
}
