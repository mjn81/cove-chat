import { useTranslation } from 'react-i18next';
import { AtSign } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/utils';
import type { MentionMember } from '../utils/mention';

interface MentionPopupProps {
	/** Text typed after the `@`. */
	query: string | null;
	members: MentionMember[];
	selectedIndex: number;
	onHover: (index: number) => void;
	onPick: (username: string) => void;
}

/** Floating member list shown above the composer while typing an @mention. */
export const MentionPopup = ({ query, members, selectedIndex, onHover, onPick }: MentionPopupProps) => {
	const { t } = useTranslation();

	return (
		<div
			data-mention-popup
			// Keep focus (and the caret) in the textarea while pressing a suggestion.
			onMouseDown={(e) => e.preventDefault()}
			className="absolute bottom-full start-4 z-[100] mb-2 w-64 overflow-hidden rounded-lg border border-border bg-popover animate-in slide-in-from-bottom-2 duration-150">
			<div className="flex items-center gap-2 border-b border-border p-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
				<AtSign size={14} />
				{t('composer.mention_header', { query: query ?? '' })}
			</div>
			<div className="max-h-60 overflow-y-auto py-1">
				{members.map((m, i) => (
					<button
						key={m.id}
						type="button"
						onClick={() => onPick(m.username)}
						onMouseEnter={() => onHover(i)}
						className={cn(
							'flex w-full items-center gap-3 px-3 py-2 text-start transition-colors',
							i === selectedIndex
								? 'bg-primary text-primary-foreground'
								: 'text-foreground hover:bg-accent',
						)}
					>
						<Avatar userId={m.id} size={24} />
						<span className="font-medium">{m.username}</span>
					</button>
				))}
				{members.length === 0 && (
					<div className="px-4 py-3 text-sm italic text-muted-foreground">{t('composer.no_members')}</div>
				)}
			</div>
		</div>
	);
};
