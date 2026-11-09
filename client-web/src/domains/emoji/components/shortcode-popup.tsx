import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { CustomEmojiItem } from '../types/emoji.types';
import { CustomEmojiImage } from './emoji';

interface ShortcodePopupProps {
	/** Text typed after the colon. */
	query: string | null;
	items: CustomEmojiItem[];
	selectedIndex: number;
	onHover: (index: number) => void;
	onPick: (name: string) => void;
}

/** Floating list of custom emoji shown above the composer while typing a `:shortcode`. */
export function ShortcodePopup({ query, items, selectedIndex, onHover, onPick }: ShortcodePopupProps) {
	const { t } = useTranslation();
	return (
		<div
			// Keep focus (and the caret) in the textarea while pressing a suggestion.
			onMouseDown={(e) => e.preventDefault()}
			className="absolute bottom-full start-4 z-[100] mb-2 w-64 overflow-hidden rounded-lg border border-border bg-popover animate-in slide-in-from-bottom-2 duration-150"
		>
			<div className="border-b border-border p-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
				{t('emoji.shortcode.header', { query: query ?? '' })}
			</div>
			<div className="max-h-60 overflow-y-auto py-1">
				{items.map((item, i) => (
					<button
						key={item.name}
						type="button"
						onClick={() => onPick(item.name)}
						onMouseEnter={() => onHover(i)}
						className={cn(
							'flex w-full items-center gap-3 px-3 py-1.5 text-start transition-colors',
							i === selectedIndex ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent',
						)}
					>
						<CustomEmojiImage name={item.name} url={item.url} size={24} />
						<span className="truncate text-sm font-medium">:{item.name}:</span>
					</button>
				))}
			</div>
		</div>
	);
}
