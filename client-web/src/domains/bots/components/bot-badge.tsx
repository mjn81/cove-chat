import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * The BOT badge shown next to every bot name (messages, members, profile). Flat on purpose: only bot message
 * buttons and the action menu use the glass style.
 */
export function BotBadge({ className }: { className?: string }) {
	const { t } = useTranslation();
	return (
		<span
			className={cn(
				'inline-flex shrink-0 select-none items-center rounded-sm bg-primary px-1.5 text-[10px] font-bold uppercase leading-4 tracking-wide text-primary-foreground',
				className,
			)}
		>
			{t('bots.badge')}
		</span>
	);
}
