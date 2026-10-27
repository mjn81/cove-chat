import type { TFunction } from 'i18next';
import { splitErrorKey } from './admin-format';

/**
 * Turns a failed admin request into display text. The backend sends i18n keys
 * (`admin.errors.password_invalid`), sometimes followed by `: detail` for
 * validation problems; anything that is not a known key is shown as-is.
 *
 * @param t - i18next translate function.
 * @param err - The caught value.
 */
export function adminErrorMessage(t: TFunction, err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	const { key, detail } = splitErrorKey(raw);
	const text = t(key, { defaultValue: key.startsWith('admin.') || key.startsWith('auth.') ? t('admin.errors.generic') : key });
	return detail ? `${text} (${detail})` : text;
}
