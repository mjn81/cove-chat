import { draftAssets, draftToTheme, type ThemeDraft } from '../utils/theme-draft';
import { COVETHEME_EXTENSION, buildCoveTheme } from '../utils/covetheme';
import { dexieThemeStore } from './dexie-theme-store';
import { installThemeFromBytes, type CanDecode, type InstallResult, type ThemeFile, type ThemeStore } from './theme-library';

/**
 * Packs a draft as a `.covetheme` file, with the same writer the exporter uses.
 *
 * @param draft The theme being edited.
 */
export function draftToThemeFile(draft: ThemeDraft): ThemeFile {
	return { fileName: `${draft.id}${COVETHEME_EXTENSION}`, bytes: buildCoveTheme(draftToTheme(draft), draftAssets(draft)) };
}

/**
 * Saves a draft to this device. It goes through the file route (write the archive, then install it) so an edited
 * theme is held to exactly the rules of an imported one: contrast floor, image checks, reserved ids, install limit.
 *
 * @param draft The theme being edited.
 * @param store Where installed themes live.
 * @param options `canDecode` overrides the browser image decoder (tests).
 */
export function saveDraft(
	draft: ThemeDraft,
	store: ThemeStore = dexieThemeStore,
	options: { canDecode?: CanDecode } = {},
): Promise<InstallResult> {
	return installThemeFromBytes(draftToThemeFile(draft).bytes, store, options);
}
