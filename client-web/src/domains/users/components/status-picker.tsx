import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/store/store';
import { cn } from '@/lib/utils';

interface StatusOption {
	id: 'auto' | 'online' | 'away' | 'dnd' | 'offline';
	/** Dot colour token; `auto` shows an "A" instead. */
	dot: string;
	labelKey: string;
}

const OPTIONS: StatusOption[] = [
	{ id: 'auto', dot: 'bg-primary', labelKey: 'account.status_auto' },
	{ id: 'online', dot: 'bg-success', labelKey: 'status.online' },
	{ id: 'away', dot: 'bg-warning', labelKey: 'account.status_idle' },
	{ id: 'dnd', dot: 'bg-destructive', labelKey: 'status.dnd' },
	{ id: 'offline', dot: 'bg-muted-foreground', labelKey: 'account.status_invisible' },
];

/** Row of presence choices (auto, online, idle, do-not-disturb, invisible) saved to the account immediately. */
export const StatusPicker = () => {
	const { t } = useTranslation();
	const preference = useAuthStore((s) => s.user?.status_preference) || 'auto';
	const updateUser = useAuthStore((s) => s.updateUser);
	const [isUpdating, setIsUpdating] = useState(false);

	const choose = async (id: StatusOption['id']) => {
		setIsUpdating(true);
		try {
			await updateUser({ status_preference: id });
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<div className="border-t border-border/40 pt-3">
			<div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
				{t('account.online_status')}
			</div>
			<div className="flex gap-2" role="radiogroup" aria-label={t('account.online_status')}>
				{OPTIONS.map((s) => {
					const selected = preference === s.id;
					return (
						<button
							key={s.id}
							type="button"
							role="radio"
							aria-checked={selected}
							disabled={isUpdating}
							onClick={() => choose(s.id)}
							title={t(s.labelKey)}
							aria-label={t(s.labelKey)}
							className={cn(
								'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-all disabled:cursor-not-allowed disabled:opacity-50',
								selected ? 'bg-primary/20 ring-1 ring-primary' : 'bg-secondary/40 hover:bg-secondary/60',
							)}
						>
							{s.id === 'auto' ? (
								<span className="text-[10px] font-bold text-primary">A</span>
							) : (
								<span className={cn('h-3 w-3 rounded-full', s.dot)} />
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
};
