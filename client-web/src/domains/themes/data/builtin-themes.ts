/**
 * The built-in themes, defined as data in the same tokens `index.css` uses. Palettes are re-expressed from
 * permissively licensed colour schemes (MIT or similar); none carries a logo or a brand name.
 *
 * Authoring uses hex literals for readability; they are converted to the canonical `H S% L%` form here, once, at
 * module load. Foreground colours that sit on a coloured surface are chosen automatically for contrast, and a unit
 * test checks the contrast of every pair for every theme.
 */
import type { PartialTokenSet, ThemeDefinition, TokenSet } from '../types/themes.types';
import { hexToHslTriplet, mixHex, pickForeground } from '../utils/color';

/** The few colours a variant needs; everything else is derived. */
interface Palette {
	background: string;
	card: string;
	popover: string;
	foreground: string;
	mutedForeground: string;
	primary: string;
	accent: string;
	border: string;
	destructive: string;
	success: string;
	warning: string;
	/** Optional overrides. */
	secondary?: string;
	muted?: string;
	primaryForeground?: string;
}

const h = hexToHslTriplet;

/** Expands a palette into the full token set. */
function tokensFrom(p: Palette): TokenSet {
	const fg = h(p.foreground);
	const warn = h(p.warning);
	return {
		background: h(p.background),
		foreground: fg,
		card: h(p.card),
		'card-foreground': fg,
		popover: h(p.popover),
		'popover-foreground': fg,
		primary: h(p.primary),
		'primary-foreground': p.primaryForeground ? h(p.primaryForeground) : pickForeground(h(p.primary)),
		secondary: h(p.secondary ?? p.card),
		'secondary-foreground': fg,
		muted: h(p.muted ?? p.card),
		'muted-foreground': h(p.mutedForeground),
		accent: h(p.accent),
		'accent-foreground': fg,
		destructive: h(p.destructive),
		'destructive-foreground': pickForeground(h(p.destructive)),
		border: h(p.border),
		input: h(p.border),
		ring: h(p.primary),
		'mention-background': hexToHslTriplet(mixHex(p.background, p.warning, 0.22)),
		'mention-foreground': warn,
		'mention-border': warn,
		success: h(p.success),
		'success-foreground': pickForeground(h(p.success)),
		warning: warn,
		'warning-foreground': pickForeground(warn),
		overlay: '0 0% 0%',
		'overlay-foreground': '0 0% 100%',
	};
}

/** Cove dark: copied verbatim from `index.css` (a test keeps them in sync). */
const COVE_DARK: TokenSet = {
	background: '20 6% 13%',
	foreground: '25 10% 90%',
	card: '20 6% 17%',
	'card-foreground': '25 10% 90%',
	popover: '20 6% 10%',
	'popover-foreground': '25 10% 90%',
	primary: '13 59% 63%',
	'primary-foreground': '14 53% 11%',
	secondary: '20 6% 17%',
	'secondary-foreground': '25 10% 90%',
	muted: '20 6% 17%',
	'muted-foreground': '22 6% 66%',
	accent: '20 6% 22%',
	'accent-foreground': '25 10% 90%',
	destructive: '355 83% 66%',
	'destructive-foreground': '0 0% 100%',
	border: '20 6% 26%',
	input: '20 6% 26%',
	ring: '13 59% 63%',
	'mention-background': '38 44% 16%',
	'mention-foreground': '39 88% 68%',
	'mention-border': '39 88% 68%',
	success: '148 48% 56%',
	'success-foreground': '149 53% 9%',
	warning: '39 88% 68%',
	'warning-foreground': '40 100% 8%',
	overlay: '0 0% 0%',
	'overlay-foreground': '0 0% 100%',
};

/** Cove light: copied verbatim from `index.css`. */
const COVE_LIGHT: TokenSet = {
	background: '0 0% 100%',
	foreground: '24 19% 11%',
	card: '30 36% 96%',
	'card-foreground': '24 19% 11%',
	popover: '0 0% 100%',
	'popover-foreground': '24 19% 11%',
	primary: '12 51% 53%',
	'primary-foreground': '0 0% 100%',
	secondary: '30 36% 96%',
	'secondary-foreground': '24 19% 11%',
	muted: '30 36% 96%',
	'muted-foreground': '26 9% 44%',
	accent: '30 30% 91%',
	'accent-foreground': '24 19% 11%',
	destructive: '0 66% 53%',
	'destructive-foreground': '0 0% 100%',
	border: '30 28% 87%',
	input: '30 28% 87%',
	ring: '12 51% 53%',
	'mention-background': '45 100% 88%',
	'mention-foreground': '39 100% 27%',
	'mention-border': '39 100% 27%',
	success: '142 54% 39%',
	'success-foreground': '0 0% 100%',
	warning: '39 100% 27%',
	'warning-foreground': '0 0% 100%',
	overlay: '0 0% 0%',
	'overlay-foreground': '0 0% 100%',
};

/** Id of the default theme. */
export const DEFAULT_THEME_ID = 'cove';

/** Cove's complete palettes by mode: the fallback for any token a theme omits. */
export const COVE_TOKENS: Record<'dark' | 'light', TokenSet> = { dark: COVE_DARK, light: COVE_LIGHT };

const MIT = 'MIT';

function theme(
	id: string,
	name: ThemeDefinition['name'],
	base: 'dark' | 'light',
	tokens: PartialTokenSet,
	light?: PartialTokenSet,
	license: string = MIT,
): ThemeDefinition {
	return { id, name, author: 'Cove', license, base, tokens, ...(light ? { light } : {}) };
}

/** All built-in themes, default first. */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = [
	theme('cove', { en: 'Cove', fa: 'کاو', ar: 'كوف' }, 'dark', COVE_DARK, COVE_LIGHT),

	theme(
		'violet-night',
		{ en: 'Violet Night', fa: 'شب بنفش', ar: 'ليل بنفسجي' },
		'dark',
		tokensFrom({
			background: '#313338', card: '#2b2d31', popover: '#1e1f22', foreground: '#dbdee1', mutedForeground: '#9da1a8',
			primary: '#5865f2', accent: '#3f4147', border: '#3f4147', destructive: '#f23f43', success: '#3ba55d', warning: '#f0b232',
		}),
		tokensFrom({
			background: '#ffffff', card: '#f2f3f5', popover: '#ffffff', foreground: '#313338', mutedForeground: '#5c5f66',
			primary: '#4752c4', accent: '#e3e5e8', border: '#d7d9dc', destructive: '#c9302c', success: '#1f7a3f', warning: '#8a5a00',
		}),
	),

	theme(
		'skyline',
		{ en: 'Skyline', fa: 'افق آبی', ar: 'أفق أزرق' },
		'dark',
		tokensFrom({
			background: '#17212b', card: '#1e2c3a', popover: '#0e1621', foreground: '#f5f5f5', mutedForeground: '#8a9aa8',
			primary: '#5eb5f7', accent: '#2b3f52', border: '#2b3a49', destructive: '#ec7676', success: '#6cc07a', warning: '#f0b25c',
		}),
		tokensFrom({
			background: '#ffffff', card: '#f1f3f4', popover: '#ffffff', foreground: '#1b1f23', mutedForeground: '#5a6670',
			primary: '#1d72b8', accent: '#e4e8ec', border: '#d8dde2', destructive: '#c0392b', success: '#1e7a3c', warning: '#8a5a00',
		}),
	),

	theme(
		'crimson',
		{ en: 'Crimson', fa: 'ارغوانی سرخ', ar: 'قرمزي' },
		'dark',
		tokensFrom({
			background: '#0f0f0f', card: '#181818', popover: '#212121', foreground: '#f1f1f1', mutedForeground: '#aaaaaa',
			primary: '#ff4e45', accent: '#272727', border: '#303030', destructive: '#ff6b6b', success: '#4cc38a', warning: '#f5c04a',
		}),
		tokensFrom({
			background: '#ffffff', card: '#f2f2f2', popover: '#ffffff', foreground: '#0f0f0f', mutedForeground: '#5f5f5f',
			primary: '#cc0000', accent: '#e8e8e8', border: '#dcdcdc', destructive: '#a61b1b', success: '#1e7a3c', warning: '#8a5a00',
		}),
	),

	theme(
		'nord',
		{ en: 'Nord', fa: 'نُرد', ar: 'نورد' },
		'dark',
		tokensFrom({
			background: '#2e3440', card: '#3b4252', popover: '#272c36', foreground: '#eceff4', mutedForeground: '#a9b3c4',
			primary: '#88c0d0', accent: '#434c5e', border: '#4c566a', destructive: '#e07b85', success: '#a3be8c', warning: '#ebcb8b',
		}),
		tokensFrom({
			background: '#eceff4', card: '#e5e9f0', popover: '#ffffff', foreground: '#2e3440', mutedForeground: '#4c566a',
			primary: '#3f6a93', accent: '#d8dee9', border: '#cdd4e0', destructive: '#b0303d', success: '#4f7a3a', warning: '#8a5f00',
		}),
	),

	theme(
		'catppuccin',
		{ en: 'Catppuccin', fa: 'کاپوچینو', ar: 'كابتشينو' },
		'dark',
		tokensFrom({
			background: '#1e1e2e', card: '#313244', popover: '#181825', foreground: '#cdd6f4', mutedForeground: '#a6adc8',
			primary: '#cba6f7', accent: '#45475a', border: '#45475a', destructive: '#f38ba8', success: '#a6e3a1', warning: '#f9e2af',
		}),
		tokensFrom({
			background: '#eff1f5', card: '#e6e9ef', popover: '#ffffff', foreground: '#4c4f69', mutedForeground: '#5c5f77',
			primary: '#8839ef', accent: '#ccd0da', border: '#bcc0cc', destructive: '#d20f39', success: '#2f7d1f', warning: '#8a5a00',
		}),
		'MIT',
	),

	theme(
		'dracula',
		{ en: 'Dracula', fa: 'دراکولا', ar: 'دراكولا' },
		'dark',
		tokensFrom({
			background: '#282a36', card: '#21222c', popover: '#191a21', foreground: '#f8f8f2', mutedForeground: '#9aa5ce',
			primary: '#bd93f9', accent: '#44475a', border: '#44475a', destructive: '#ff6e6e', success: '#50fa7b', warning: '#f1fa8c',
		}),
	),

	theme(
		'solarized',
		{ en: 'Solarized', fa: 'سولاریزد', ar: 'سولارايزد' },
		'dark',
		tokensFrom({
			background: '#002b36', card: '#073642', popover: '#00212b', foreground: '#a3b0b0', mutedForeground: '#93a1a1',
			primary: '#2aa5f0', accent: '#0d4351', border: '#134a58', destructive: '#e8605d', success: '#85b900', warning: '#d9a521',
		}),
		tokensFrom({
			background: '#fdf6e3', card: '#eee8d5', popover: '#fffbee', foreground: '#3f565e', mutedForeground: '#4d646b',
			primary: '#1b6aa5', accent: '#e4ddc6', border: '#d9d2bb', destructive: '#b52a27', success: '#5f7a00', warning: '#8a5f00',
		}),
	),

	theme(
		'gruvbox',
		{ en: 'Gruvbox', fa: 'گراوباکس', ar: 'غروفبوكس' },
		'dark',
		tokensFrom({
			background: '#282828', card: '#3c3836', popover: '#1d2021', foreground: '#ebdbb2', mutedForeground: '#b5a58e',
			primary: '#fabd2f', accent: '#504945', border: '#504945', destructive: '#fb6a55', success: '#b8bb26', warning: '#fe8019',
		}),
		tokensFrom({
			background: '#fbf1c7', card: '#ebdbb2', popover: '#f9f5d7', foreground: '#3c3836', mutedForeground: '#665c54',
			primary: '#af3a03', accent: '#d5c4a1', border: '#d5c4a1', destructive: '#9d0006', success: '#5f6800', warning: '#8a4a00',
		}),
	),

	theme(
		'amoled-black',
		{ en: 'AMOLED Black', fa: 'مشکی آمولد', ar: 'أسود أمولد' },
		'dark',
		tokensFrom({
			background: '#000000', card: '#0b0b0b', popover: '#000000', foreground: '#f2f2f2', mutedForeground: '#9a9a9a',
			primary: '#d9826a', accent: '#1a1a1a', border: '#262626', destructive: '#f0616d', success: '#58c48a', warning: '#f5c265',
		}),
	),

	theme(
		'paper',
		{ en: 'Paper', fa: 'کاغذ', ar: 'ورق' },
		'light',
		tokensFrom({
			background: '#faf6ee', card: '#f1ebdd', popover: '#fffdf8', foreground: '#2b2620', mutedForeground: '#665d51',
			primary: '#8a5a2b', accent: '#e8dfcb', border: '#ddd2bb', destructive: '#b3261e', success: '#2f7d4a', warning: '#8a5a00',
		}),
	),
];

const BY_ID = new Map(BUILTIN_THEMES.map((t) => [t.id, t]));

/** Looks up a built-in theme by id. */
export function getBuiltinTheme(id: string): ThemeDefinition | undefined {
	return BY_ID.get(id);
}

/** True for ids that belong to a built-in theme; installed themes may not reuse them. */
export function isBuiltinThemeId(id: string): boolean {
	return BY_ID.has(id);
}
