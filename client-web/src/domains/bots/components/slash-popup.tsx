import { SquareSlash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { ChannelCommand } from '../types/bots.types';
import { usageLine } from '../utils/slash-command';
import { BotBadge } from './bot-badge';

interface SlashPopupProps {
	items: ChannelCommand[];
	selectedIndex: number;
	onHover: (index: number) => void;
	onPick: (command: ChannelCommand) => void;
}

/** Floating command list shown above the composer while typing `/name`. */
export function SlashPopup({ items, selectedIndex, onHover, onPick }: SlashPopupProps) {
	const { t } = useTranslation();
	return (
		<div
			data-slash-popup
			// Keep focus (and the caret) in the textarea while pressing a suggestion.
			onMouseDown={(e) => e.preventDefault()}
			role="listbox"
			aria-label={t('bots.composer.commands')}
			className="absolute bottom-full start-4 z-[100] mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover animate-in slide-in-from-bottom-2 duration-150"
		>
			<div className="flex items-center gap-2 border-b border-border p-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
				<SquareSlash size={14} />
				{t('bots.composer.commands')}
			</div>
			<div className="max-h-60 overflow-y-auto py-1">
				{items.map((c, i) => (
					<button
						key={`${c.bot_id}:${c.name}`}
						type="button"
						role="option"
						aria-selected={i === selectedIndex}
						onClick={() => onPick(c)}
						onMouseEnter={() => onHover(i)}
						className={cn(
							'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start transition-colors',
							i === selectedIndex ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent',
						)}
					>
						<span className="flex w-full items-center gap-2">
							<span className="truncate font-medium">{usageLine(c)}</span>
							<BotBadge className="ms-auto" />
						</span>
						<span
							className={cn(
								'truncate text-xs',
								i === selectedIndex ? 'text-primary-foreground/80' : 'text-muted-foreground',
							)}
						>
							{c.bot_username} · {c.description}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
