import type { ThemeAsset, ThemeDefinition } from '../types/themes.types';
import { COVETHEME_LIMITS, parseCoveTheme } from '../utils/covetheme';
import type { ThemeIssue } from '../utils/tokens';
import { decodeWithBrowser, type CanDecode } from './theme-library';

/** What looking inside a theme file found. Nothing has been applied or installed in either case. */
export type InspectResult =
	| { ok: true; theme: ThemeDefinition; assets: Record<string, ThemeAsset>; warnings: ThemeIssue[]; bytes: Uint8Array }
	| { ok: false; errors: ThemeIssue[] };

/**
 * Reads a theme file for the chat card: size check first (so a huge file is never downloaded), then the strict
 * parser, then the browser's own image decoder for any image. The card shows what this returns and applies nothing.
 *
 * @param input `size` is the size the sender claimed; `load` downloads and decrypts the bytes.
 * @param options `canDecode` overrides the image decoder (tests).
 */
export async function inspectThemeFile(
	input: { size: number; load: () => Promise<Uint8Array> },
	options: { canDecode?: CanDecode } = {},
): Promise<InspectResult> {
	if (input.size > COVETHEME_LIMITS.maxArchiveBytes) return { ok: false, errors: [{ code: 'zip_too_large' }] };
	let bytes: Uint8Array;
	try {
		bytes = await input.load();
	} catch {
		return { ok: false, errors: [{ code: 'download_failed' }] };
	}
	const parsed = parseCoveTheme(bytes);
	if (!parsed.ok) return { ok: false, errors: parsed.errors };
	const canDecode = options.canDecode ?? decodeWithBrowser;
	for (const [path, asset] of Object.entries(parsed.assets)) {
		if (!(await canDecode(asset))) return { ok: false, errors: [{ code: 'image_undecodable', detail: path }] };
	}
	return { ok: true, theme: parsed.theme, assets: parsed.assets, warnings: parsed.warnings, bytes };
}
