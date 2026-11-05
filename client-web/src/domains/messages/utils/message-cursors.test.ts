import { beforeEach, describe, expect, it } from 'vitest';
import { clearMessageCursors, nextMessageCursor, rememberMessageCursor } from './message-cursors';

describe('message cursors', () => {
	beforeEach(() => clearMessageCursors());

	it('returns the cursor remembered for the oldest message of the last loaded page', () => {
		rememberMessageCursor('ch1', [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }], 'CUR');
		expect(nextMessageCursor('ch1', [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }])).toBe('CUR');
	});

	it('is scoped per channel', () => {
		rememberMessageCursor('ch1', [{ id: 'm1' }], 'CUR');
		expect(nextMessageCursor('ch2', [{ id: 'm1' }])).toBeUndefined();
	});

	it('does not remember anything on the last page (no cursor)', () => {
		rememberMessageCursor('ch1', [{ id: 'm1' }], undefined);
		rememberMessageCursor('ch1', [{ id: 'm2' }], '');
		expect(nextMessageCursor('ch1', [{ id: 'm1' }])).toBeUndefined();
		expect(nextMessageCursor('ch1', [{ id: 'm2' }])).toBeUndefined();
	});

	it('ignores a client-only pending placeholder at the oldest position and an empty page', () => {
		expect(nextMessageCursor('ch1', [])).toBeUndefined();
	});
});
