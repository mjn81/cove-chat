import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileIcon, Loader2, Lock, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { QueuedAttachment } from '../hooks/use-attachments';

/** Object URL for an image file, revoked when the preview goes away (the old inline version leaked one per render). */
function useObjectUrl(file: File, enabled: boolean) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!enabled) return;
		const objectUrl = URL.createObjectURL(file);
		// The URL's lifetime must be tied to this effect so it is revoked on cleanup.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setUrl(objectUrl);
		return () => URL.revokeObjectURL(objectUrl);
	}, [file, enabled]);
	return url;
}

interface PreviewProps {
	item: QueuedAttachment;
	onRemove: (id: string) => void;
	onRetry: (id: string) => void;
}

const AttachmentPreview = ({ item, onRemove, onRetry }: PreviewProps) => {
	const { t } = useTranslation();
	const isImage = !item.asDocument && item.file.type.startsWith('image/');
	const previewUrl = useObjectUrl(item.file, isImage);
	const busy = item.status !== 'idle' && item.status !== 'done';

	return (
		<div className="group relative flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-md bg-accent/30 p-2">
			<button
				type="button"
				onClick={() => onRemove(item.id)}
				aria-label={t('composer.remove_file')}
				className="absolute -end-1 -top-1 z-20 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
			>
				<X size={14} />
			</button>

			{isImage && previewUrl ? (
				<img
					src={previewUrl}
					alt={t('composer.preview_alt')}
					className={cn('h-full w-full rounded object-cover', busy && 'opacity-50 blur-sm')}
				/>
			) : (
				<div className="flex flex-col items-center gap-1">
					<FileIcon size={32} className="text-muted-foreground" />
					<span className="w-20 truncate text-center text-[10px] text-muted-foreground">
						{item.file.name}
					</span>
				</div>
			)}

			{item.status === 'failed' ? (
				<button
					type="button"
					onClick={() => onRetry(item.id)}
					className="group/retry absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md bg-destructive/20 p-2"
					title={item.error || t('composer.retry_hint')}
				>
					<AlertCircle size={16} className="text-destructive" />
					<span className="text-[9px] font-semibold text-destructive group-hover/retry:underline">
						{t('composer.retry')}
					</span>
				</button>
			) : (
				busy && (
					<div className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-background/80 p-2">
						{item.status === 'encrypting' ? (
							<Lock size={16} className="animate-pulse text-primary" />
						) : (
							<Loader2 size={16} className="animate-spin text-foreground" />
						)}
						<div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full bg-primary transition-all duration-300"
								style={{ width: `${item.progress}%` }}
							/>
						</div>
					</div>
				)
			)}
		</div>
	);
};

/** Horizontal strip of queued attachments with progress, remove and retry. */
export const AttachmentPreviews = ({
	items,
	onRemove,
	onRetry,
}: {
	items: QueuedAttachment[];
	onRemove: (id: string) => void;
	onRetry: (id: string) => void;
}) => (
	<div className="flex gap-3 overflow-x-auto border-b border-border p-3">
		{items.map((item) => (
			<AttachmentPreview key={item.id} item={item} onRemove={onRemove} onRetry={onRetry} />
		))}
	</div>
);
