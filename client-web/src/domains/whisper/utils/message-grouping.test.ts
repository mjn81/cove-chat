import { describe, expect, it } from 'vitest';

import { isSameSenderBurst } from './message-grouping';

const msg = (senderId: string, sentAt: number) => ({ senderId, sentAt });

describe('isSameSenderBurst', () => {
	it('never groups the first message', () => {
		expect(isSameSenderBurst(undefined, msg('a', 1000))).toBe(false);
	});

	it('groups consecutive messages from one sender within five minutes', () => {
		expect(isSameSenderBurst(msg('a', 0), msg('a', 299_999))).toBe(true);
	});

	it('starts a new group after five minutes or when the sender changes', () => {
		expect(isSameSenderBurst(msg('a', 0), msg('a', 300_000))).toBe(false);
		expect(isSameSenderBurst(msg('a', 0), msg('b', 1000))).toBe(false);
	});
});
