// guardrail-allow hexOrRgbLiteral: banner colours are user data stored as hex, not theme colours.

/** Colour used when a user never picked a profile banner. Stored data shared with Android, so it is not a theme token. */
export const DEFAULT_BANNER_COLOR = '#5865F2';

/** Swatches offered in the banner colour picker (any 6-digit hex can also be typed). */
export const BANNER_PRESETS = [
	'#5865F2',
	'#57F287',
	'#FEE75C',
	'#ED4245',
	'#EB459E',
	'#00A8FC',
	'#E67E22',
	'#9B59B6',
	'#1ABC9C',
	'#2ECC71',
	'#E91E63',
	'#3498DB',
	'#34495E',
	'#4E5058',
	'#2B2D31',
	'#1E1F22',
] as const;
