import type { LucideIcon } from 'lucide-react';
import type { SettingsTab } from './types';

interface TabButtonProps {
	id: SettingsTab;
	label: string;
	icon: LucideIcon;
	activeTab: SettingsTab;
	setActiveTab: (id: SettingsTab) => void;
	badge?: number | string;
}

export const TabButton = ({
	id,
	label,
	icon: Icon,
	activeTab,
	setActiveTab,
	badge,
}: TabButtonProps) => (
	<button
		onClick={() => setActiveTab(id)}
		className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-all text-sm font-medium cursor-pointer select-none ${
			activeTab === id
				? 'bg-accent text-accent-foreground shadow-sm'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
		}`}
	>
		<div className="flex items-center gap-2.5 min-w-0">
			<Icon
				size={18}
				className={`pointer-events-none shrink-0 ${
					activeTab === id ? 'text-accent-foreground' : 'text-muted-foreground'
				}`}
			/>
			<span className="pointer-events-none truncate">{label}</span>
		</div>
		{badge !== undefined && (
			<span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary text-primary-foreground font-bold font-mono">
				{badge}
			</span>
		)}
	</button>
);
