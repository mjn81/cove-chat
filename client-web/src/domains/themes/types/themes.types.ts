/** Light or dark appearance. Also the class set on `<html>` so Tailwind's `dark:` variants keep working. */
export type ThemeMode = 'dark' | 'light';

/** Names of the CSS custom properties a theme may set (without the leading `--`). */
export type ThemeTokenName =
	| 'background'
	| 'foreground'
	| 'card'
	| 'card-foreground'
	| 'popover'
	| 'popover-foreground'
	| 'primary'
	| 'primary-foreground'
	| 'secondary'
	| 'secondary-foreground'
	| 'muted'
	| 'muted-foreground'
	| 'accent'
	| 'accent-foreground'
	| 'destructive'
	| 'destructive-foreground'
	| 'border'
	| 'input'
	| 'ring'
	| 'mention-background'
	| 'mention-foreground'
	| 'mention-border'
	| 'success'
	| 'success-foreground'
	| 'warning'
	| 'warning-foreground'
	| 'overlay'
	| 'overlay-foreground';

/** Token values as canonical `H S% L%` triplets. Possibly incomplete until completed against a fallback. */
export type PartialTokenSet = Partial<Record<ThemeTokenName, string>>;

/** Every token present. */
export type TokenSet = Record<ThemeTokenName, string>;

/** Display name per UI language; `en` is always present. */
export interface LocalizedName {
	en: string;
	fa?: string;
	ar?: string;
}

/** The built-in chat doodle patterns (see `utils/chat-backgrounds.ts`). */
export type ChatPatternId =
	| 'animals'
	| 'space'
	| 'games'
	| 'sweets'
	| 'travel'
	| 'nature'
	| 'food'
	| 'music'
	| 'tech'
	| 'weather';

/** How a theme image is fitted behind the chat. */
export type ChatImageFit = 'cover' | 'contain' | 'tile';

/** What sits behind the messages. Colours are canonical triplets. */
export type ChatBackgroundConfig =
	| { type: 'none' }
	| { type: 'pattern'; pattern: ChatPatternId }
	| { type: 'color'; color: string }
	| { type: 'gradient'; from: string; to: string; angle: number }
	| {
			type: 'image';
			/** Path inside the archive, `assets/<name>`. */
			asset: string;
			/** 0 to 1. */
			opacity: number;
			/** Blur radius in px, 0 to 20. */
			blur: number;
			fit: ChatImageFit;
	  };

/** Chat-specific look a theme can carry. */
export interface ThemeChat {
	background?: ChatBackgroundConfig;
	/** Optional tint for message bubbles; `strength` is 0 to 1. */
	bubbleTint?: { color: string; strength: number };
}

/**
 * A validated theme. Built-in themes and anything produced by the `.covetheme` parser have this shape; nothing
 * else reaches the engine.
 *
 * `tokens` apply when the user's mode equals `base`. `light` is only meaningful for a dark-base theme and holds the
 * variant used in light mode; a theme without the variant for the requested mode keeps its base look.
 */
export interface ThemeDefinition {
	id: string;
	name: LocalizedName;
	author?: string;
	license?: string;
	base: ThemeMode;
	tokens: PartialTokenSet;
	light?: PartialTokenSet;
	chat?: ThemeChat;
	/** Path of the preview image inside the archive, when one is shipped. */
	preview?: string;
}

/** A theme resolved for a mode: the mode actually shown and a complete token set. */
export interface ResolvedTheme {
	mode: ThemeMode;
	tokens: TokenSet;
}

/** An image file shipped inside a `.covetheme` (already checked: type, size and dimensions). */
export interface ThemeAsset {
	mime: 'image/png' | 'image/jpeg' | 'image/webp';
	bytes: Uint8Array;
	width: number;
	height: number;
}

/** A theme installed on this device (IndexedDB row). */
export interface InstalledTheme {
	id: string;
	definition: ThemeDefinition;
	/** Keyed by archive path (`assets/...`). */
	assets: Record<string, ThemeAsset>;
	installed_at: number;
}
