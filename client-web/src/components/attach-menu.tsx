import { useTranslation } from 'react-i18next';
import { FileText, ImageIcon, Music, Plus } from 'lucide-react';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { UploadMode } from '@/hooks/use-file-picker';



interface AttachMenuProps {
	compact: boolean;
	disabled?: boolean;
	onPick: (mode: UploadMode) => void;
}

/** "+" button with the photo/video, audio and document choices. */
export const AttachMenu = ({ compact, disabled, onPick }: AttachMenuProps) => {
	const { t } = useTranslation();
	const itemClass = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium';

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className="mt-0.5 cursor-pointer text-muted-foreground transition hover:text-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					title={t('composer.add_attachment')}
					aria-label={t('composer.add_attachment')}
				>
					<Plus
						className={cn(
							'rounded-full bg-muted-foreground/10 p-1 hover:bg-muted-foreground/20',
							compact ? 'h-5 w-5' : 'h-6 w-6',
						)}
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="top"
				sideOffset={8}
				className="w-44 rounded-xl border-border bg-popover p-1"
			>
				<DropdownMenuItem onClick={() => onPick('media')} className={itemClass}>
					<ImageIcon size={16} className="text-primary" />
					<span>{t('composer.photo_video')}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onPick('audio')} className={itemClass}>
					<Music size={16} className="text-primary" />
					<span>{t('composer.audio')}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onPick('file')} className={itemClass}>
					<FileText size={16} className="text-primary" />
					<span>{t('composer.document')}</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
