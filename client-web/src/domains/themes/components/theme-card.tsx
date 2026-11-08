import { Check, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ThemeDefinition, ThemeMode } from '../types/themes.types';
import { localizedThemeName } from '../utils/theme-name';
import { ThemePreview, ThemeSwatches } from './theme-preview';

interface ThemeCardProps {
	theme: ThemeDefinition;
	mode: ThemeMode;
	selected: boolean;
	onSelect: (theme: ThemeDefinition) => void;
	/** Present for installed themes only. */
	onDelete?: (theme: ThemeDefinition) => void;
}

/**
 * One theme in the picker: live mini preview, colour strip, name and author. The delete control is a sibling of
 * the select button (not nested inside it) so both stay valid, focusable buttons.
 */
export function ThemeCard({ theme, mode, selected, onSelect, onDelete }: ThemeCardProps) {
	const { t, i18n } = useTranslation();
	const name = localizedThemeName(theme.name, i18n.language);
	return (
		<div className="group relative">
			<button
				type="button"
				onClick={() => onSelect(theme)}
				aria-pressed={selected}
				aria-label={t('themes.select_aria', { name })}
				className={cn(
					'flex w-full select-none flex-col gap-2 rounded-lg border-2 bg-secondary p-2 text-start transition-colors',
					selected ? 'border-primary' : 'border-transparent hover:bg-secondary/80',
				)}
			>
				<div className="relative">
					<ThemePreview theme={theme} mode={mode} />
					{selected && (
						<div className="absolute bottom-1 end-1 rounded-full bg-primary p-0.5 text-primary-foreground">
							<Check size={12} />
						</div>
					)}
				</div>
				<ThemeSwatches theme={theme} mode={mode} />
				<div className="min-w-0 px-0.5">
					<div className={cn('truncate text-sm font-semibold', selected ? 'text-foreground' : 'text-muted-foreground')}>
						{name}
					</div>
					{theme.author && (
						<div className="truncate text-[11px] text-muted-foreground">{t('themes.by_author', { author: theme.author })}</div>
					)}
				</div>
			</button>
			{onDelete && (
				<button
					type="button"
					onClick={() => onDelete(theme)}
					aria-label={t('themes.delete_aria', { name })}
					title={t('themes.delete')}
					className="absolute end-3 top-3 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
				>
					<Trash2 size={14} />
				</button>
			)}
		</div>
	);
}
