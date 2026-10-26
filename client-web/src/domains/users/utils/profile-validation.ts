/** Shortest username the server accepts. */
export const MIN_USERNAME_LENGTH = 3;

/**
 * Client-side username check (the server still has the final say, e.g. for
 * "taken").
 *
 * @returns `'empty'`, `'short'`, or `null` when the name is acceptable.
 */
export function validateUsername(value: string): 'empty' | 'short' | null {
	const trimmed = value.trim();
	if (!trimmed) return 'empty';
	if (trimmed.length < MIN_USERNAME_LENGTH) return 'short';
	return null;
}

/** Strips everything but hex digits from the banner colour field and caps it at six characters. */
export function sanitizeHexInput(value: string): string {
	return value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
}
