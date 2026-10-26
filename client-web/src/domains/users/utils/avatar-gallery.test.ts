import { describe, expect, it } from 'vitest';

import {
	MAX_AVATARS,
	galleryAfterRemove,
	galleryAfterUpload,
	getGallery,
	promoteInGallery,
} from './avatar-gallery';

describe('getGallery', () => {
	it('prefers the multi-avatar list', () => {
		expect(getGallery({ avatar_ids: ['a', 'b'], avatar_id: 'a' })).toEqual(['a', 'b']);
	});

	it('falls back to the single primary avatar for accounts without a gallery', () => {
		expect(getGallery({ avatar_ids: [], avatar_id: 'a' })).toEqual(['a']);
		expect(getGallery({ avatar_id: 'a' })).toEqual(['a']);
	});

	it('is empty when the user has no avatar or no user', () => {
		expect(getGallery({})).toEqual([]);
		expect(getGallery(null)).toEqual([]);
	});
});

describe('promoteInGallery', () => {
	it('moves the chosen photo to the front without duplicating it', () => {
		expect(promoteInGallery(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
	});
});

describe('galleryAfterUpload', () => {
	it('puts the new photo first and caps the gallery at the maximum', () => {
		const full = Array.from({ length: MAX_AVATARS }, (_, i) => `old${i}`);
		const next = galleryAfterUpload(full, 'new');
		expect(next[0]).toBe('new');
		expect(next).toHaveLength(MAX_AVATARS);
		expect(next).not.toContain(`old${MAX_AVATARS - 1}`);
	});

	it('does not duplicate a re-uploaded id', () => {
		expect(galleryAfterUpload(['a', 'b'], 'b')).toEqual(['b', 'a']);
	});
});

describe('galleryAfterRemove', () => {
	it('keeps the primary when a different photo is removed', () => {
		expect(galleryAfterRemove(['a', 'b', 'c'], 'a', 'b')).toEqual({ avatar_ids: ['a', 'c'], avatar_id: 'a' });
	});

	it('promotes the next photo when the primary is removed', () => {
		expect(galleryAfterRemove(['a', 'b'], 'a', 'a')).toEqual({ avatar_ids: ['b'], avatar_id: 'b' });
	});

	it('clears the primary when the last photo is removed', () => {
		expect(galleryAfterRemove(['a'], 'a', 'a')).toEqual({ avatar_ids: [], avatar_id: '' });
	});
});
