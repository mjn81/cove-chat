/** Mirrors the server rule: 2-32 lowercase letters, digits, `_`, `.` or `-`, starting with a letter or digit. */
const BOT_NAME = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

/**
 * Whether `name` is an acceptable bot name. The server is the authority; this only avoids a round trip for typos.
 *
 * @param name - The trimmed name typed by the user.
 */
export function isValidBotName(name: string): boolean {
	return BOT_NAME.test(name);
}
