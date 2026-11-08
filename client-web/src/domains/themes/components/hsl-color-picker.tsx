import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { hslToTriplet, parseColorValue, tripletToHex, tripletToHsl } from '../utils/color';

interface HslColorPickerProps {
	/** Already-translated name of the colour. */
	label: string;
	/** Canonical `H S% L%` triplet. */
	value: string;
	onChange: (triplet: string) => void;
}

/** One labelled slider row. */
function Channel({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
	return (
		<div className="flex items-center gap-3">
			<span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
			<Slider min={0} max={max} step={1} value={[value]} onValueChange={([n]) => onChange(n)} aria-label={label} />
			<span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{Math.round(value)}</span>
		</div>
	);
}

/**
 * A colour row that opens an HSL picker: three sliders and a hex field. Colours are held as the same `H S% L%`
 * triplets the CSS variables use, so what you pick is what the theme file stores.
 */
export function HslColorPicker({ label, value, onChange }: HslColorPickerProps) {
	const { t } = useTranslation();
	const [h, s, l] = tripletToHsl(value);
	// What the user is typing; `null` means the field simply shows the current colour.
	const [typed, setTyped] = useState<string | null>(null);
	const hex = typed ?? tripletToHex(value);

	const commitHex = () => {
		const parsed = parseColorValue(hex.trim());
		if (parsed) onChange(parsed.value);
		setTyped(null);
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
					aria-label={t('themes.editor.pick_colour', { name: label })}
				>
					<span className="size-6 shrink-0 rounded-md border border-border" style={{ backgroundColor: `hsl(${value})` }} />
					<span className="min-w-0 flex-1 truncate">{label}</span>
					<span dir="ltr" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
						{tripletToHex(value)}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-72 space-y-3 p-3" align="start">
				<div className="flex items-center gap-2.5">
					<span className="size-9 shrink-0 rounded-md border border-border" style={{ backgroundColor: `hsl(${value})` }} />
					<div className="text-sm font-semibold">{label}</div>
				</div>
				{/* Hue, saturation and lightness; the slider order is the same in every language. */}
				<div dir="ltr" className="space-y-2.5">
					<Channel label="H" value={h} max={360} onChange={(n) => onChange(hslToTriplet(n, s, l))} />
					<Channel label="S" value={s} max={100} onChange={(n) => onChange(hslToTriplet(h, n, l))} />
					<Channel label="L" value={l} max={100} onChange={(n) => onChange(hslToTriplet(h, s, n))} />
				</div>
				<Input
					dir="ltr"
					value={hex}
					onChange={(e) => setTyped(e.target.value)}
					onBlur={commitHex}
					onKeyDown={(e) => {
						if (e.key === 'Enter') commitHex();
					}}
					maxLength={7}
					autoComplete="off"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					aria-label={t('themes.editor.hex')}
					className="h-8 font-mono text-xs"
				/>
			</PopoverContent>
		</Popover>
	);
}
