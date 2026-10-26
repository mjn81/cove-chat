import { describe, expect, it } from 'vitest';

import { buildFileMetadata } from './file-metadata';

describe('buildFileMetadata', () => {
	const base = { fileId: 'f1', name: 'a.png', mime: 'image/png', size: 12, nonce: 'bm9uY2U=' };

	it('serialises the wire format with snake_case keys', () => {
		expect(JSON.parse(buildFileMetadata(base))).toEqual({
			file_id: 'f1',
			name: 'a.png',
			mime: 'image/png',
			size: 12,
			nonce: 'bm9uY2U=',
		});
	});

	it('includes thumbnails, duration, document and processing flags only when given', () => {
		const parsed = JSON.parse(
			buildFileMetadata({
				...base,
				thumbCiphertext: 'dGg=',
				thumbNonce: 'dG4=',
				duration: 7,
				asDocument: true,
				processingStatus: 'processing',
			}),
		);
		expect(parsed).toMatchObject({
			thumb_ciphertext: 'dGg=',
			thumb_nonce: 'dG4=',
			duration: 7,
			as_document: true,
			processing_status: 'processing',
		});
	});

	it('omits as_document when it is false', () => {
		expect(JSON.parse(buildFileMetadata({ ...base, asDocument: false }))).not.toHaveProperty('as_document');
	});
});
