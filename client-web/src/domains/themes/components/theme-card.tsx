import { Check, Eye, Pencil, Trash2 } from 'lucide-react';
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
	/** Shows the theme across the app under the floating bar, without selecting it. */
	onPreview?: (theme: ThemeDefinition) => void;
	/** Opens the editor: in place for installed themes, as a copy for built-ins. */
	onEdit?: (theme: ThemeDefinition) => void;
	/** Where the theme came from; shown as a small label. */
	origin?: 'builtin' | 'file';
}

/**
 * One theme in the picker: live mini preview, colour strip, name and author. The delete control is a sibling of
 * the select button (not nested inside it) so both stay valid, focusable buttons.
 */
export function ThemeCard({ theme, mode, selected, onSelect, onDelete, onPreview, onEdit, origin }: ThemeCardProps) {
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
					{origin && (
						<div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/80">
							{t(origin === 'file' ? 'themes.origin_file' : 'themes.origin_builtin')}
						</div>
					)}
				</div>
			</button>
			<div className="absolute end-3 top-3 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
				{onPreview && (
					<button
						type="button"
						onClick={() => onPreview(theme)}
						aria-label={t('themes.preview_aria', { name })}
						title={t('themes.card.preview')}
						className="rounded-md bg-background/80 p-1 text-muted-foreground hover:text-foreground"
					>
						<Eye size={14} />
					</button>
				)}
				{onEdit && (
					<button
						type="button"
						onClick={() => onEdit(theme)}
						aria-label={t(onDelete ? 'themes.edit_aria' : 'themes.customize_aria', { name })}
						title={t(onDelete ? 'themes.editor.edit' : 'themes.editor.customize')}
						className="rounded-md bg-background/80 p-1 text-muted-foreground hover:text-foreground"
					>
						<Pencil size={14} />
					</button>
				)}
				{onDelete && (
					<button
						type="button"
						onClick={() => onDelete(theme)}
						aria-label={t('themes.delete_aria', { name })}
						title={t('themes.delete')}
						className="rounded-md bg-background/80 p-1 text-muted-foreground hover:text-destructive"
					>
						<Trash2 size={14} />
					</button>
				)}
			</div>
		</div>
	);
}
