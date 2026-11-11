import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { BotButton } from '../types/bots.types';
import { isSafeButtonUrl } from '../utils/bot-message';

interface BotButtonGridProps {
	rows: BotButton[][];
	/** Called for callback buttons with the button's `custom_id`. */
	onPress: (customId: string) => void;
	/** The `custom_id` currently waiting for the bot, shown with a spinner. */
	pendingId?: string | null;
	/** Disables every callback button (offline, sending). */
	disabled?: boolean;
	/** `menu` buttons are larger and fill the row (the action menu). */
	variant?: 'message' | 'menu';
	className?: string;
}

/**
 * A grid of bot buttons in the glass style. Callback buttons call `onPress`; URL buttons are plain links that open
 * in a new tab (http and https only, `noopener noreferrer nofollow`).
 */
export function BotButtonGrid({ rows, onPress, pendingId, disabled, variant = 'message', className }: BotButtonGridProps) {
	const { t } = useTranslation();
	// Telegram-style: every row fills the width evenly (buttons share it equally, labels truncate), 4px gaps.
	const size = variant === 'menu' ? 'min-h-11 px-4 py-2 text-sm' : 'min-h-10 px-3 py-1.5 text-[13px]';
	return (
		<div className={cn('flex flex-col gap-1', className)} role="group">
			{rows.map((row, i) => (
				<div key={i} className="flex gap-1">
					{row.map((b, j) => {
						const common = cn('bot-glass inline-flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-lg text-center font-medium', size);
						if (b.url) {
							if (!isSafeButtonUrl(b.url)) return null;
							return (
								<a
									key={j}
									href={b.url}
									target="_blank"
									rel="noopener noreferrer nofollow"
									data-style={b.style ?? 'secondary'}
									title={t('bots.message.open_link')}
									className={common}
								>
									<span className="truncate">{b.label}</span>
									<ArrowUpRight size={13} className="shrink-0 opacity-70 rtl:-scale-x-100" aria-hidden />
								</a>
							);
						}
						const pending = pendingId != null && pendingId === b.custom_id;
						return (
							<button
								key={j}
								type="button"
								data-style={b.style ?? 'secondary'}
								disabled={disabled || b.disabled || pending}
								aria-busy={pending || undefined}
								onClick={() => !pending && b.custom_id && onPress(b.custom_id)}
								className={common}
							>
								{pending && <Loader2 size={13} className="animate-spin" aria-hidden />}
								<span className="truncate">{b.label}</span>
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}
