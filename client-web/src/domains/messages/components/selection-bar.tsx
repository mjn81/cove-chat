import React from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Forward, Reply, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BOTTOM_BAR_HEIGHT_CLASS } from '@/lib/layout';
import { cn } from '@/lib/utils';
import type { SelectionActions } from '../utils/message-selection';

interface SelectionBarProps {
	count: number;
	actions: SelectionActions;
	onClear: () => void;
	onReply: () => void;
	onCopy: () => void;
	onForward: () => void;
	onDelete: () => void;
}

/**
 * Replaces the composer while messages are selected (Telegram style): the count, then only the actions that fit the
 * selection (see `selectionActions`). Delete appears only when every selected message may be deleted.
 */
export const SelectionBar: React.FC<SelectionBarProps> = ({
	count,
	actions,
	onClear,
	onReply,
	onCopy,
	onForward,
	onDelete,
}) => {
	const { t } = useTranslation();
	return (
		<div
			className={cn(
				'flex shrink-0 items-center gap-1 border-t border-border/50 bg-secondary px-3',
				BOTTOM_BAR_HEIGHT_CLASS,
			)}
		>
			<Button type="button" variant="ghost" size="icon" onClick={onClear} title={t('chat.selection.cancel')} aria-label={t('chat.selection.cancel')}>
				<X size={18} />
			</Button>
			<span className="me-auto text-sm font-semibold text-foreground">{t('chat.selection.count', { count })}</span>
			{actions.canReply && (
				<Button type="button" variant="ghost" size="sm" onClick={onReply} className="gap-1.5">
					<Reply size={16} />
					<span className="hidden sm:inline">{t('chat.selection.reply')}</span>
				</Button>
			)}
			{actions.canCopy && (
				<Button type="button" variant="ghost" size="sm" onClick={onCopy} className="gap-1.5">
					<Copy size={16} />
					<span className="hidden sm:inline">{t('chat.selection.copy')}</span>
				</Button>
			)}
			{actions.canForward && (
				<Button type="button" variant="ghost" size="sm" onClick={onForward} className="gap-1.5">
					<Forward size={16} className="rtl:-scale-x-100" />
					<span className="hidden sm:inline">{t('chat.selection.forward')}</span>
				</Button>
			)}
			{actions.canDelete && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onDelete}
					className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
				>
					<Trash2 size={16} />
					<span className="hidden sm:inline">{t('chat.selection.delete')}</span>
				</Button>
			)}
		</div>
	);
};
