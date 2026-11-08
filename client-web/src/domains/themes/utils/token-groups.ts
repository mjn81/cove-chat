import type { ThemeTokenName } from '../types/themes.types';

/** A section of the editor's colour list. `id` keys the label `themes.editor.groups.<id>`. */
export interface TokenGroup {
	id: 'surfaces' | 'text' | 'brand' | 'status' | 'lines' | 'extras';
	tokens: readonly ThemeTokenName[];
}

/** The allow-listed tokens, grouped the way a person thinks about them. Every token appears exactly once. */
export const TOKEN_GROUPS: readonly TokenGroup[] = [
	{ id: 'surfaces', tokens: ['background', 'card', 'popover', 'secondary', 'muted', 'accent'] },
	{ id: 'text', tokens: ['foreground', 'card-foreground', 'popover-foreground', 'secondary-foreground', 'muted-foreground', 'accent-foreground'] },
	{ id: 'brand', tokens: ['primary', 'primary-foreground', 'ring'] },
	{ id: 'status', tokens: ['destructive', 'destructive-foreground', 'success', 'success-foreground', 'warning', 'warning-foreground'] },
	{ id: 'lines', tokens: ['border', 'input'] },
	{ id: 'extras', tokens: ['mention-background', 'mention-foreground', 'mention-border', 'overlay', 'overlay-foreground'] },
];
