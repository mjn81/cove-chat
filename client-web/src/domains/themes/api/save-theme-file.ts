import { isWails } from '@/utils/wails';
import { SaveFile } from '@/wailsjs/go/main/App';
import { bytesToBase64 } from '@/ws';
import { COVETHEME_MIME } from '../utils/covetheme';
import type { ThemeFile } from './theme-library';

/**
 * Saves a theme file for the user: through the desktop shell's Downloads folder, or as a browser download.
 *
 * @param file The packed theme.
 * @returns The saved path in the desktop app, otherwise `null`.
 */
export async function saveThemeFile(file: ThemeFile): Promise<string | null> {
	if (isWails()) return SaveFile(file.fileName, bytesToBase64(file.bytes));
	const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: COVETHEME_MIME }));
	const a = document.createElement('a');
	a.href = url;
	a.download = file.fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 100);
	return null;
}
