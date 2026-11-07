import { describe, expect, it } from 'vitest';

import {
	AVATAR_TONES,
	MAX_AVATAR_DATA_URL_LENGTH,
	avatarInitial,
	avatarTone,
	buildSenderFields,
	isPopupAvatar,
} from './sender-avatar';

describe('avatarInitial', () => {
	it('uses the first letter, upper-cased', () => {
		expect(avatarInitial('sam')).toBe('S');
		expect(avatarInitial('  zoë ')).toBe('Z');
	});
	it('skips leading symbols and handles non-Latin names', () => {
		expect(avatarInitial('@mina')).toBe('M');
		expect(avatarInitial('علی')).toBe('ع');
	});
	it('falls back to ? for nothing usable', () => {
		expect(avatarInitial('')).toBe('?');
		expect(avatarInitial('###')).toBe('?');
	});
});

describe('avatarTone', () => {
	it('is deterministic and within range', () => {
		expect(avatarTone('user-1')).toBe(avatarTone('user-1'));
		for (const id of ['a', 'b', 'user-42', 'عل']) {
			const tone = avatarTone(id);
			expect(tone).toBeGreaterThanOrEqual(0);
			expect(tone).toBeLessThan(AVATAR_TONES);
		}
	});
	it('spreads different senders over several colours', () => {
		const tones = new Set(Array.from({ length: 40 }, (_, i) => avatarTone(`user-${i}`)));
		expect(tones.size).toBeGreaterThan(2);
	});
});

describe('isPopupAvatar', () => {
	it('accepts small raster data URLs only', () => {
		expect(isPopupAvatar('data:image/jpeg;base64,AAAA')).toBe(true);
		expect(isPopupAvatar('data:image/svg+xml;base64,AAAA')).toBe(false);
		expect(isPopupAvatar('blob:http://x/1')).toBe(false);
		expect(isPopupAvatar(null)).toBe(false);
		expect(isPopupAvatar('data:image/png;base64,' + 'A'.repeat(MAX_AVATAR_DATA_URL_LENGTH))).toBe(false);
	});
});

describe('buildSenderFields', () => {
	it('carries the photo when there is one', () => {
		expect(buildSenderFields({ id: 'u1', name: 'Sam' }, 'data:image/jpeg;base64,AAAA')).toMatchObject({
			avatar: 'data:image/jpeg;base64,AAAA',
			initial: 'S',
			system: false,
		});
	});
	it('falls back to the letter avatar and drops unsafe images', () => {
		const f = buildSenderFields({ id: 'u1', name: 'Sam' }, 'https://evil/x.png');
		expect(f.avatar).toBe('');
		expect(f.initial).toBe('S');
	});
	it('marks system senders and handles no sender', () => {
		expect(buildSenderFields({ id: 's', name: 'Cove', system: true }).system).toBe(true);
		expect(buildSenderFields(undefined)).toEqual({ avatar: '', initial: '', tone: 0, system: false });
	});
});
