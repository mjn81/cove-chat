import { describe, it, expect } from 'vitest';
import { canCreatePack, checkStickerFile, fitWithin, isAnimatedImage, MAX_UPLOAD_BYTES } from './sticker-upload';
import type { PackQuota } from '../types/stickers.types';

const quota: PackQuota = {
	user_uploads_enabled: true,
	max_packs: 2,
	max_stickers_per_pack: 3,
	max_storage_bytes: 1000,
	owned_packs: 0,
	used_storage_bytes: 0,
	sticker_max_bytes: 512 * 1024,
	sticker_max_side: 512,
};

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('isAnimatedImage', () => {
	it('detects an animated WebP by the VP8X animation flag', () => {
		const bytes = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0x02, 0, 0, 0]);
		expect(isAnimatedImage(bytes, 'image/webp')).toBe(true);
	});
	it('treats a static WebP as static', () => {
		const vp8x = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0x00, 0, 0, 0]);
		const lossy = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 '), 10, 0, 0, 0, 0x02, 0, 0, 0]);
		expect(isAnimatedImage(vp8x, 'image/webp')).toBe(false);
		expect(isAnimatedImage(lossy, 'image/webp')).toBe(false);
		expect(isAnimatedImage(new Uint8Array(4), 'image/webp')).toBe(false);
	});
	it('detects a GIF with several frames', () => {
		const frame = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0];
		const header = [...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0];
		expect(isAnimatedImage(new Uint8Array([...header, ...frame, ...frame]), 'image/gif')).toBe(true);
		expect(isAnimatedImage(new Uint8Array([...header, ...frame]), 'image/gif')).toBe(false);
	});
	it('never calls PNG or JPEG animated', () => {
		expect(isAnimatedImage(new Uint8Array(64), 'image/png')).toBe(false);
	});
});

describe('checkStickerFile', () => {
	it('accepts a normal image', () => {
		expect(checkStickerFile({ type: 'image/png', size: 1000 }, quota, 0)).toBeNull();
	});
	it('refuses unsupported types such as SVG', () => {
		expect(checkStickerFile({ type: 'image/svg+xml', size: 10 }, quota, 0)).toBe('type');
		expect(checkStickerFile({ type: '', size: 10 }, quota, 0)).toBe('type');
	});
	it('refuses files above the 4 MB read limit', () => {
		expect(checkStickerFile({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 }, quota, 0)).toBe('too_large');
	});
	it('applies the quota', () => {
		expect(checkStickerFile({ type: 'image/png', size: 10 }, { ...quota, user_uploads_enabled: false }, 0)).toBe('uploads_disabled');
		expect(checkStickerFile({ type: 'image/png', size: 10 }, quota, 3)).toBe('pack_full');
		expect(checkStickerFile({ type: 'image/png', size: 10 }, { ...quota, used_storage_bytes: 1000 }, 0)).toBe('storage_full');
	});
	it('does not guess without a quota', () => {
		expect(checkStickerFile({ type: 'image/png', size: 10 }, undefined, 99)).toBeNull();
	});
});

describe('fitWithin', () => {
	it('keeps small images, shrinks large ones keeping the ratio', () => {
		expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
		expect(fitWithin(1024, 512, 512)).toEqual({ width: 512, height: 256 });
		expect(fitWithin(600, 1200, 512)).toEqual({ width: 256, height: 512 });
	});
});

describe('canCreatePack', () => {
	it('reports the reason', () => {
		expect(canCreatePack(quota)).toBe('ok');
		expect(canCreatePack({ ...quota, owned_packs: 2 })).toBe('pack_limit');
		expect(canCreatePack({ ...quota, user_uploads_enabled: false })).toBe('uploads_disabled');
		expect(canCreatePack(undefined)).toBe('ok');
	});
});
