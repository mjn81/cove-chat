import type { ThemeAsset } from '../types/themes.types';
import { COVETHEME_LIMITS } from './covetheme';
import { sniffImage } from './image-sniff';

/** Result of {@link assetFromBytes}. */
export type BackgroundImageResult = { ok: true; asset: ThemeAsset } | { ok: false; code: 'image_type_mismatch' | 'image_too_large' | 'image_dimensions' };

/**
 * Checks image bytes the user picked or the editor produced against the theme format's image rules (PNG, JPEG or
 * WebP by magic bytes, at most 2 MB and 4096 px a side) and wraps them as a theme asset. The codes match the ones
 * the file validator reports, so the same messages apply.
 *
 * @param bytes Encoded image bytes.
 */
export function assetFromBytes(bytes: Uint8Array): BackgroundImageResult {
	const sniffed = sniffImage(bytes);
	if (!sniffed) return { ok: false, code: 'image_type_mismatch' };
	if (bytes.length > COVETHEME_LIMITS.maxImageBytes) return { ok: false, code: 'image_too_large' };
	if (sniffed.width > COVETHEME_LIMITS.maxImageSide || sniffed.height > COVETHEME_LIMITS.maxImageSide) {
		return { ok: false, code: 'image_dimensions' };
	}
	return { ok: true, asset: { mime: sniffed.mime, bytes, width: sniffed.width, height: sniffed.height } };
}

/** Compression steps tried in order until the image fits the size limit: `[longest side in px, quality]`. */
export const COMPRESSION_STEPS: ReadonlyArray<readonly [number, number]> = [
	[2048, 0.82],
	[1600, 0.72],
	[1200, 0.6],
	[900, 0.5],
];

/**
 * Re-encodes an image until it fits the theme image limit.
 *
 * @param compress Re-encodes at a maximum side and quality (the app passes `compressImageFile`).
 * @returns The first result that passes {@link assetFromBytes}, or the last failure.
 */
export async function fitBackgroundImage(
	compress: (maxSide: number, quality: number) => Promise<Uint8Array>,
): Promise<BackgroundImageResult> {
	let last: BackgroundImageResult = { ok: false, code: 'image_type_mismatch' };
	for (const [side, quality] of COMPRESSION_STEPS) {
		last = assetFromBytes(await compress(side, quality));
		if (last.ok || last.code !== 'image_too_large') return last;
	}
	return last;
}
