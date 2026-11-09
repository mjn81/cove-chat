import { COVETHEME_EXTENSION, COVETHEME_MIME } from './covetheme';

/**
 * Whether a file message carries a theme, judged by its decrypted metadata: the `.covetheme` extension or the theme
 * mime type. Android-sent files have the same bytes and name, so they match the same way. This only decides which
 * card is drawn; the bytes are still fully validated before anything is shown or applied.
 *
 * @param meta The file message metadata (`name` may be missing).
 */
export function isThemeFile(meta: { name?: string; mime: string }): boolean {
	return meta.mime.toLowerCase() === COVETHEME_MIME || (meta.name?.toLowerCase().endsWith(COVETHEME_EXTENSION) ?? false);
}
