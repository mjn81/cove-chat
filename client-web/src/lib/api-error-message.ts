/** Translate function shape this module needs (i18next's `t` satisfies it). */
type Translate = (key: string, options?: { detail?: string; defaultValue?: string }) => string;

const API_ERROR_KEY = /^(apiErrors\.[a-z_]+)(?:: (.*))?$/;

/**
 * Turns a server error message into display text. The backend sends `apiErrors.<name>` i18n keys for the
 * user-facing handlers (optionally `: detail`, e.g. the size limit, exposed to the translation as `{{detail}}`);
 * anything else (older servers, `admin.errors.*` / `auth.errors.*` keys that their own screens translate, plain
 * text) is returned unchanged.
 *
 * @param message - The `error` field of the response envelope.
 * @param t - Translate function.
 * @returns the localized text, or `message` when it is not an `apiErrors` key.
 */
export function localizeApiErrorMessage(message: string, t: Translate): string {
	const match = API_ERROR_KEY.exec(message);
	if (!match) return message;
	return t(match[1], { detail: match[2], defaultValue: t('errors.unknown') });
}
