import { describe, it, expect } from 'vitest';
import { encodeSticker, parseSticker, stickerFilePath, stickerPreviewLabel } from './sticker-message';

describe('encodeSticker / parseSticker', () => {
	it('round-trips a built-in sticker with an empty file id', () => {
		const text = encodeSticker('cove-basics', { id: 'rocket' });
		expect(JSON.parse(text)).toEqual({ pack_id: 'cove-basics', sticker_id: 'rocket', file_id: '' });
		expect(parseSticker(text)).toEqual({ pack_id: 'cove-basics', sticker_id: 'rocket', file_id: '' });
	});
	it('carries the stored file id of a user sticker', () => {
		expect(parseSticker(encodeSticker('p1', { id: 'i1', file_id: 'f1' }))).toEqual({
			pack_id: 'p1',
			sticker_id: 'i1',
			file_id: 'f1',
		});
	});
	it('rejects anything that is not a valid body', () => {
		expect(parseSticker(undefined)).toBeNull();
		expect(parseSticker('')).toBeNull();
		expect(parseSticker('not json')).toBeNull();
		expect(parseSticker('[]')).toBeNull();
		expect(parseSticker('{"pack_id":"a"}')).toBeNull();
		expect(parseSticker('{"pack_id":"","sticker_id":"b"}')).toBeNull();
		expect(parseSticker('{"pack_id":1,"sticker_id":"b"}')).toBeNull();
		expect(parseSticker(`{"pack_id":"${'x'.repeat(129)}","sticker_id":"b"}`)).toBeNull();
		expect(parseSticker('{"pack_id":"a","sticker_id":"b","file_id":5}')).toBeNull();
	});
	it('tolerates a missing file id', () => {
		expect(parseSticker('{"pack_id":"a","sticker_id":"b"}')).toEqual({ pack_id: 'a', sticker_id: 'b', file_id: '' });
	});
});

describe('stickerFilePath', () => {
	it('points stored stickers at the channel-less file', () => {
		expect(stickerFilePath({ pack_id: 'p', sticker_id: 's', file_id: 'f 1' })).toBe('/api/files/f%201');
	});
	it('has no path for built-in stickers (file id empty or equal to the sticker id)', () => {
		expect(stickerFilePath({ pack_id: 'cove-basics', sticker_id: 'rocket', file_id: '' })).toBeNull();
		expect(stickerFilePath({ pack_id: 'cove-basics', sticker_id: 'rocket', file_id: 'rocket' })).toBeNull();
	});
});

describe('stickerPreviewLabel', () => {
	it('prefixes the emoji when there is one', () => {
		expect(stickerPreviewLabel('Sticker', '🚀')).toBe('🚀 Sticker');
		expect(stickerPreviewLabel('Sticker')).toBe('Sticker');
	});
});
