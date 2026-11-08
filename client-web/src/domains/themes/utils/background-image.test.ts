import { describe, expect, it, vi } from 'vitest';
import { assetFromBytes, fitBackgroundImage } from './background-image';
import { COVETHEME_LIMITS } from './covetheme';

/** PNG header declaring a size. */
function png(width: number, height: number, total = 40): Uint8Array {
	const b = new Uint8Array(total);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}

describe('assetFromBytes', () => {
	it('accepts a small PNG and reads its size', () => {
		const r = assetFromBytes(png(300, 200));
		expect(r).toMatchObject({ ok: true, asset: { mime: 'image/png', width: 300, height: 200 } });
	});

	it('rejects anything that is not PNG, JPEG or WebP, whatever it is called', () => {
		expect(assetFromBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ ok: false, code: 'image_type_mismatch' });
		expect(assetFromBytes(new TextEncoder().encode('GIF89a......................'))).toEqual({ ok: false, code: 'image_type_mismatch' });
	});

	it('rejects oversized files and dimensions', () => {
		expect(assetFromBytes(png(10, 10, COVETHEME_LIMITS.maxImageBytes + 1))).toEqual({ ok: false, code: 'image_too_large' });
		expect(assetFromBytes(png(5000, 10))).toEqual({ ok: false, code: 'image_dimensions' });
	});
});

describe('fitBackgroundImage', () => {
	it('stops at the first step that fits', async () => {
		const compress = vi
			.fn<(side: number, quality: number) => Promise<Uint8Array>>()
			.mockResolvedValueOnce(png(10, 10, COVETHEME_LIMITS.maxImageBytes + 5))
			.mockResolvedValueOnce(png(10, 10));
		const r = await fitBackgroundImage(compress);
		expect(r.ok).toBe(true);
		expect(compress).toHaveBeenCalledTimes(2);
		expect(compress.mock.calls[1][0]).toBeLessThan(compress.mock.calls[0][0]);
	});

	it('gives up with the size error when nothing fits', async () => {
		const r = await fitBackgroundImage(async () => png(10, 10, COVETHEME_LIMITS.maxImageBytes + 5));
		expect(r).toEqual({ ok: false, code: 'image_too_large' });
	});

	it('does not retry for errors smaller files cannot fix', async () => {
		const compress = vi.fn(async () => new Uint8Array([1, 2, 3]));
		expect(await fitBackgroundImage(compress)).toEqual({ ok: false, code: 'image_type_mismatch' });
		expect(compress).toHaveBeenCalledTimes(1);
	});
});
