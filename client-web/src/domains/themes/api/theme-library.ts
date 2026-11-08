import { isBuiltinThemeId } from '../data/builtin-themes';
import type { InstalledTheme, ThemeAsset, ThemeDefinition } from '../types/themes.types';
import { COVETHEME_EXTENSION, buildCoveTheme, parseCoveTheme } from '../utils/covetheme';
import type { ThemeIssue } from '../utils/tokens';

/** How many themes a device keeps. Each can hold up to 8 MB of images. */
export const MAX_INSTALLED_THEMES = 30;

/** Where installed themes live. The app uses IndexedDB (`dexie-theme-store.ts`); tests use a map. */
export interface ThemeStore {
	list: () => Promise<InstalledTheme[]>;
	get: (id: string) => Promise<InstalledTheme | undefined>;
	put: (row: InstalledTheme) => Promise<void>;
	delete: (id: string) => Promise<void>;
}

/** Outcome of an install. */
export type InstallResult =
	| { ok: true; theme: ThemeDefinition; replaced: boolean; warnings: ThemeIssue[] }
	| { ok: false; error: ThemeIssue; errors: ThemeIssue[] };

/** Whether the browser can decode an image. The default uses `createImageBitmap`; injected in tests. */
export type CanDecode = (asset: ThemeAsset) => Promise<boolean>;

/**
 * Decodes the image with the browser's own decoder. A file that passed the header checks but is not really an
 * image (truncated, hostile) is rejected here instead of reaching a `<div>` background later.
 */
export const decodeWithBrowser: CanDecode = async (asset) => {
	if (typeof createImageBitmap !== 'function') return true; // no decoder to ask (old engines): header checks stand
	try {
		const bitmap = await createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
		bitmap.close();
		return true;
	} catch {
		return false;
	}
};

const fail = (code: string, detail?: string): InstallResult => {
	const error = detail === undefined ? { code } : { code, detail };
	return { ok: false, error, errors: [error] };
};

/**
 * Validates a `.covetheme` file and installs it on this device.
 *
 * @param bytes The file contents.
 * @param store Where to keep the theme.
 * @param options `canDecode` overrides the browser image decoder (tests).
 */
export async function installThemeFromBytes(
	bytes: Uint8Array,
	store: ThemeStore,
	options: { canDecode?: CanDecode } = {},
): Promise<InstallResult> {
	const parsed = parseCoveTheme(bytes);
	if (!parsed.ok) return { ok: false, error: parsed.error, errors: parsed.errors };
	const { theme, assets, warnings } = parsed;

	if (isBuiltinThemeId(theme.id)) return fail('reserved_id', theme.id);

	const canDecode = options.canDecode ?? decodeWithBrowser;
	for (const [path, asset] of Object.entries(assets)) {
		if (!(await canDecode(asset))) return fail('image_undecodable', path);
	}

	const existing = await store.get(theme.id);
	if (!existing && (await store.list()).length >= MAX_INSTALLED_THEMES) return fail('too_many_themes');

	await store.put({ id: theme.id, definition: theme, assets, installed_at: Date.now() });
	return { ok: true, theme, replaced: existing !== undefined, warnings };
}

/** Removes an installed theme and its images from this device. */
export async function deleteInstalledTheme(id: string, store: ThemeStore): Promise<void> {
	await store.delete(id);
}

/** A theme ready to be saved or shared. */
export interface ThemeFile {
	fileName: string;
	bytes: Uint8Array;
}

/**
 * Packs a theme (built-in or installed) as a `.covetheme` file.
 *
 * A built-in theme is exported as a copy under `<id>-copy`, because installed themes may not reuse a built-in id.
 *
 * @param theme The theme to export.
 * @param store Where installed themes (and their images) are read from.
 */
export async function exportThemeFile(theme: ThemeDefinition, store: ThemeStore): Promise<ThemeFile> {
	const builtin = isBuiltinThemeId(theme.id);
	const exported: ThemeDefinition = builtin ? { ...theme, id: `${theme.id}-copy` } : theme;
	const assets = builtin ? {} : ((await store.get(theme.id))?.assets ?? {});
	return { fileName: `${exported.id}${COVETHEME_EXTENSION}`, bytes: buildCoveTheme(exported, assets) };
}
