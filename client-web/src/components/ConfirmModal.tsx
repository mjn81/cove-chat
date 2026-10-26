import React from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/modal-shell';

interface ConfirmModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	variant?: 'danger' | 'primary';
}

/**
 * Small confirmation dialog. `onConfirm` runs first, then `onClose`.
 *
 * @param variant - `danger` shows a warning icon and a destructive confirm button.
 * @param confirmText - Defaults to the translated "Confirm".
 * @param cancelText - Defaults to the translated "Cancel".
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
	isOpen,
	onClose,
	onConfirm,
	title,
	message,
	confirmText,
	cancelText,
	variant = 'primary',
}) => {
	const { t } = useTranslation();

	return (
		<ModalShell
			open={isOpen}
			onOpenChange={(open) => !open && onClose()}
			title={title}
			size="sm"
			footer={
				<>
					<Button type="button" variant="ghost" onClick={onClose}>
						{cancelText ?? t('common.cancel')}
					</Button>
					<Button
						type="button"
						variant={variant === 'danger' ? 'destructive' : 'default'}
						onClick={() => {
							onConfirm();
							onClose();
						}}
					>
						{confirmText ?? t('common.confirm')}
					</Button>
				</>
			}
		>
			<div className="flex items-start gap-3">
				{variant === 'danger' && (
					<TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
				)}
				<p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
			</div>
		</ModalShell>
	);
};
