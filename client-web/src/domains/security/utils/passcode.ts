/** Shortest passcode the desktop shell accepts (mirrors `minPasscodeLen` in client-desktop/vault.go). */
export const MIN_PASSCODE_LENGTH = 4;

/**
 * Validates a new passcode and its confirmation before it is sent to the shell.
 *
 * @returns an i18n key suffix under `passcode.` (`tooShort` or `mismatch`), or null when valid
 */
export function validateNewPasscode(next: string, repeat: string): 'tooShort' | 'mismatch' | null {
	if ([...next].length < MIN_PASSCODE_LENGTH) return 'tooShort';
	if (next !== repeat) return 'mismatch';
	return null;
}
