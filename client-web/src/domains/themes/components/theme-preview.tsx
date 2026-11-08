import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { ThemeDefinition, ThemeMode } from '../types/themes.types';
import { resolveTheme } from '../utils/resolve-theme';
import { tokensToCssVars } from '../utils/tokens';

interface ThemePreviewProps {
	theme: ThemeDefinition;
	/** The user's mode; a theme without that variant shows its own. */
	mode: ThemeMode;
	className?: string;
}

/**
 * A miniature chat drawn in a theme's own colours. The theme's tokens are set as custom properties on this element
 * only, so every Tailwind token class inside resolves to the theme being previewed, not to the app's current one.
 *
 * @param props.theme The theme to show.
 * @param props.mode The user's light/dark preference.
 */
export function ThemePreview({ theme, mode, className }: ThemePreviewProps) {
	const { tokens } = resolveTheme(theme, mode);
	const vars = tokensToCssVars(tokens) as CSSProperties;
	return (
		<div
			aria-hidden="true"
			style={vars}
			className={cn('flex h-20 w-full overflow-hidden rounded-md border border-border bg-background text-foreground', className)}
		>
			<div className="flex w-1/4 flex-col gap-1 border-e border-border bg-card p-1.5">
				<div className="h-1.5 w-full rounded-full bg-primary" />
				<div className="h-1.5 w-3/4 rounded-full bg-muted-foreground/40" />
				<div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/40" />
			</div>
			<div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
				<div className="h-3 w-2/3 self-start rounded-md rounded-es-none bg-secondary" />
				<div className="h-3 w-1/2 self-end rounded-md rounded-ee-none bg-primary" />
				<div className="mt-0.5 h-3 w-full rounded-md border border-input bg-popover" />
			</div>
		</div>
	);
}

/**
 * A five-swatch strip of the theme's key colours (background, card, primary, accent, destructive).
 *
 * @param props.theme The theme to show.
 * @param props.mode The user's light/dark preference.
 */
export function ThemeSwatches({ theme, mode }: Omit<ThemePreviewProps, 'className'>) {
	const { tokens } = resolveTheme(theme, mode);
	const colours = [tokens.background, tokens.card, tokens.primary, tokens.accent, tokens.destructive];
	return (
		<div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full border border-border/50">
			{colours.map((c, i) => (
				<div key={i} className="flex-1" style={{ backgroundColor: `hsl(${c})` }} />
			))}
		</div>
	);
}
