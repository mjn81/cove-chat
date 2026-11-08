import { COVE_TOKENS } from '../data/builtin-themes';
import { tokensToCssVars } from './tokens';

/**
 * Colours of the "Previewing…" bar. They are fixed (Cove dark) and set on the bar itself, so whatever theme is on
 * screen, the buttons that undo it stay readable: a previewed theme can never lock the user out.
 */
export const PREVIEW_BAR_VARS: Record<string, string> = tokensToCssVars(COVE_TOKENS.dark);
