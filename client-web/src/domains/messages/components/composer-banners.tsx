import { useTranslation } from 'react-i18next';
import { AlertCircle, Plus, Reply as ReplyIcon, X } from 'lucide-react';

import { IconButton } from '@/components/icon-button';
import type { Message } from '@/types/api';

/** Full-screen "drop files to upload" overlay shown while dragging over the window. */
export const DropOverlay = ({ target, compact }: { target: string; compact: boolean }) => {
	const { t } = useTranslation();
	return (
		<div className="pointer-events-none fixed inset-0 z-[999] flex items-center justify-center border-4 border-dashed border-primary bg-primary/20 backdrop-blur-sm transition-all animate-in fade-in duration-200">
			<div className="flex flex-col items-center gap-2 rounded-2xl border border-primary/30 bg-background p-8">
				<Plus size={compact ? 32 : 48} className="text-primary" />
				<span className={compact ? 'text-lg font-bold text-foreground' : 'text-xl font-bold text-foreground'}>
					{t('composer.upload_to', { target })}
				</span>
			</div>
		</div>
	);
};

/** Dismissible red strip above the composer for send failures. */
export const SendErrorBanner = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => {
	const { t } = useTranslation();
	return (
		<div
			role="alert"
			className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[12px] font-medium text-destructive animate-in slide-in-from-bottom-2 duration-150"
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<AlertCircle size={13} className="shrink-0" />
				<span className="truncate">{message}</span>
			</div>
			<IconButton label={t('composer.dismiss')} onClick={onDismiss} className="h-5 w-5 rounded-full">
				<X size={12} />
			</IconButton>
		</div>
	);
};

interface ReplyPreviewProps {
	/** Message being replied to (decrypted text when available). */
	message: Message & { text?: string };
	/** Display name of the sender. */
	senderName: string;
	onCancel?: () => void;
}

/** "Replying to ..." strip attached to the top of the composer. */
export const ReplyPreview = ({ message, senderName, onCancel }: ReplyPreviewProps) => {
	const { t } = useTranslation();
	return (
		<div className="flex items-center justify-between gap-3 rounded-t-lg border-x border-t border-border bg-secondary px-4 py-2 animate-in slide-in-from-bottom-2 duration-150">
			<div className="flex min-w-0 items-center gap-2">
				<ReplyIcon size={14} className="shrink-0 text-muted-foreground rtl:-scale-x-100" />
				<span className="text-[13px] text-muted-foreground">
					{t('composer.replying_to')} <span className="font-bold text-foreground">{senderName}</span>
				</span>
				<span className="truncate border-s border-border ps-2 text-[13px] italic text-muted-foreground/70">
					{message.text || `[${message.type}]`}
				</span>
			</div>
			<IconButton label={t('composer.cancel_reply')} tone="destructive" onClick={onCancel} className="h-6 w-6 rounded-full">
				<X size={14} />
			</IconButton>
		</div>
	);
};
