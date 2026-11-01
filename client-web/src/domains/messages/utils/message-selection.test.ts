import { describe, expect, it } from 'vitest';

import { selectionActions, toggleSelected } from './message-selection';

const mine = (type = 'text') => ({ sender_id: 'me', type });
const theirs = (type = 'text') => ({ sender_id: 'other', type });

describe('selectionActions', () => {
	it('offers delete only when every selected message is yours', () => {
		expect(selectionActions([mine(), mine('voice')], 'me', false).canDelete).toBe(true);
		expect(selectionActions([mine(), theirs()], 'me', false).canDelete).toBe(false);
		expect(selectionActions([theirs()], 'me', false).canDelete).toBe(false);
	});

	it('lets admins delete other people’s messages too', () => {
		expect(selectionActions([mine(), theirs()], 'me', true).canDelete).toBe(true);
	});

	it('forwards text, files, voice notes, video messages and invites but not unknown types', () => {
		expect(selectionActions([mine(), theirs('file'), theirs('voice'), theirs('invite'), theirs('video')], 'me', false).canForward).toBe(true);
		expect(selectionActions([mine(), theirs('sticker')], 'me', false).canForward).toBe(false);
	});

	it('copies only when everything selected is text', () => {
		expect(selectionActions([mine(), theirs()], 'me', false).canCopy).toBe(true);
		expect(selectionActions([mine(), theirs('file')], 'me', false).canCopy).toBe(false);
	});

	it('offers reply for exactly one message', () => {
		expect(selectionActions([theirs()], 'me', false).canReply).toBe(true);
		expect(selectionActions([theirs(), mine()], 'me', false).canReply).toBe(false);
	});

	it('offers nothing for an empty selection', () => {
		expect(selectionActions([], 'me', true)).toEqual({ canDelete: false, canForward: false, canCopy: false, canReply: false });
	});
});

describe('toggleSelected', () => {
	it('adds and removes ids without mutating the input', () => {
		const start = ['a'];
		expect(toggleSelected(start, 'b')).toEqual(['a', 'b']);
		expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b']);
		expect(start).toEqual(['a']);
	});
});
