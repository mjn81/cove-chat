import { describe, it, expect } from 'vitest';
import { compressImageFile, encryptAndCompressFile } from './file';

describe('file compression utilities', () => {
	it('skips non-image files and returns them unchanged', async () => {
		const textFile = new File(['hello world'], 'test.txt', { type: 'text/plain' });
		const result = await compressImageFile(textFile);
		expect(result).toBe(textFile);
		expect(result.name).toBe('test.txt');
	});

	it('skips animated GIF files to preserve animation frames', async () => {
		const gifFile = new File(['GIF89a...'], 'animated.gif', { type: 'image/gif' });
		const result = await compressImageFile(gifFile);
		expect(result).toBe(gifFile);
		expect(result.name).toBe('animated.gif');
	});

	it('skips SVG vector files to preserve resolution independence', async () => {
		const svgFile = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });
		const result = await compressImageFile(svgFile);
		expect(result).toBe(svgFile);
	});

	it('encryptAndCompressFile returns rawBytes for immediate client caching', async () => {
		const channelKey = new Uint8Array(32);
		const file = new File(['test file content'], 'test.txt', { type: 'text/plain' });
		const processed = await encryptAndCompressFile(file, channelKey);
		expect(processed.rawBytes).toBeDefined();
		expect(new TextDecoder().decode(processed.rawBytes)).toBe('test file content');
	});
});

