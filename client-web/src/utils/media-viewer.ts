/** Direction of the document, as set on `<html dir>` by the i18n layer. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Translates an arrow key press into a gallery step. In RTL layouts the
 * "previous" arrow button sits on the right, so the keys are mirrored to keep
 * the key pointing the same way as the button.
 *
 * @param key - `KeyboardEvent.key`.
 * @param dir - Current document direction.
 * @returns `'prev'`, `'next'`, or `null` for any other key.
 */
export function resolveArrowKey(key: string, dir: TextDirection): 'prev' | 'next' | null {
	if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
	const isLeft = key === 'ArrowLeft';
	return isLeft === (dir === 'ltr') ? 'prev' : 'next';
}
