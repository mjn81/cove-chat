import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

import { IconButton } from '@/components/icon-button';
import { cn } from '@/lib/utils';
import { BANNER_PRESETS } from '../utils/banner-presets';
import { sanitizeHexInput } from '../utils/profile-validation';

interface BannerColorPickerProps {
	/** Current colour as `#RRGGBB` (may be partially typed); empty means the theme default. */
	value: string;
	onChange: (color: string) => void;
	onClose: () => void;
}

/** Swatch grid plus a hex field for choosing the profile banner colour. */
export const BannerColorPicker = ({ value, onChange, onClose }: BannerColorPickerProps) => {
	const { t } = useTranslation();

	return (
		<div className="rounded-lg border border-border bg-card p-3 animate-in fade-in zoom-in-95 duration-150">
			<div className="mb-2.5 flex items-center justify-between">
				<span className="text-xs font-bold text-foreground">{t('settings.change_banner_color')}</span>
				<IconButton label={t('common.close')} onClick={onClose} className="h-6 w-6">
					<X size={14} />
				</IconButton>
			</div>

			<div className="mb-3 grid grid-cols-8 gap-2">
				{BANNER_PRESETS.map((color) => {
					const isChosen = value.toLowerCase() === color.toLowerCase();
					return (
						<button
							key={color}
							type="button"
							onClick={() => onChange(color)}
							style={{ backgroundColor: color }}
							aria-label={color}
							aria-pressed={isChosen}
							className={cn(
								'flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border transition-transform hover:scale-110',
								isChosen && 'scale-105 ring-2 ring-foreground',
							)}
						>
							{isChosen && <Check size={13} className="text-overlay-foreground drop-shadow" />}
						</button>
					);
				})}
			</div>

			<div className="flex items-center gap-2 border-t border-border/50 pt-2">
				<div className="h-7 w-7 shrink-0 rounded-md border border-border" style={{ backgroundColor: value || 'hsl(var(--primary))' }} />
				<div dir="ltr" className="flex flex-1 items-center rounded-md border border-border bg-background px-2 py-1 text-xs">
					<span className="me-1 font-mono text-muted-foreground">#</span>
					<input
						type="text"
						maxLength={6}
						value={value.replace('#', '')}
						onChange={(e) => {
							const hex = sanitizeHexInput(e.target.value);
							onChange(hex ? '#' + hex : '');
						}}
						aria-label={t('settings.banner_color')}
						placeholder="D9826A"
						className="w-full border-none bg-transparent font-mono text-xs uppercase text-foreground outline-none"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
			</div>
		</div>
	);
};
