import { describe, expect, it } from 'vitest';
import { makeJpeg, makePng, makeWebpL, makeWebpLossy, makeWebpX } from './covetheme.fixtures';
import { sniffImage } from './image-sniff';

describe('sniffImage', () => {
	it('reads PNG dimensions', () => {
		expect(sniffImage(makePng(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480 });
	});

	it('reads JPEG dimensions past other segments', () => {
		expect(sniffImage(makeJpeg(1024, 768))).toEqual({ mime: 'image/jpeg', width: 1024, height: 768 });
	});

	it('reads all three WebP flavours', () => {
		expect(sniffImage(makeWebpX(800, 600))).toEqual({ mime: 'image/webp', width: 800, height: 600 });
		expect(sniffImage(makeWebpL(321, 123))).toEqual({ mime: 'image/webp', width: 321, height: 123 });
		expect(sniffImage(makeWebpLossy(300, 200))).toEqual({ mime: 'image/webp', width: 300, height: 200 });
	});

	it('rejects everything else by magic bytes, whatever the file name claims', () => {
		const enc = new TextEncoder();
		expect(sniffImage(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
		expect(sniffImage(enc.encode('GIF89a\x01\x00\x01\x00'))).toBeNull();
		expect(sniffImage(enc.encode('<html><script>alert(1)</script></html>'))).toBeNull();
		expect(sniffImage(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toBeNull(); // nested zip
		expect(sniffImage(new Uint8Array(0))).toBeNull();
		expect(sniffImage(new Uint8Array(5))).toBeNull();
	});

	it('rejects truncated or zero-sized images', () => {
		expect(sniffImage(makePng(640, 480).slice(0, 20))).toBeNull();
		expect(sniffImage(makePng(0, 10))).toBeNull();
		expect(sniffImage(makeJpeg(0, 0))).toBeNull();
		expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBeNull();
	});

	it('does not loop forever on a malformed JPEG segment length', () => {
		expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xe0, 0x00, 0x00]))).toBeNull();
	});
});
