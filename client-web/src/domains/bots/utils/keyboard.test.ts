import { describe, expect, it } from 'vitest';

import type { BotKeyboard } from '../types/bots.types';
import { keyboardSignature, keyboardView, pickActiveKeyboard } from './keyboard';

const kb = (over: Partial<BotKeyboard> = {}): BotKeyboard => ({
	bot_id: 'b1',
	bot_username: 'bot',
	rows: [[{ label: 'A', custom_id: 'a' }]],
	...over,
});

describe('keyboardView', () => {
	it('shows nothing without a keyboard', () => {
		expect(keyboardView(null, undefined)).toEqual({ showMenu: false, showToggle: false });
	});
	it('opens a new keyboard as the menu', () => {
		expect(keyboardView(kb(), undefined)).toEqual({ showMenu: true, showToggle: false });
		expect(keyboardView(kb(), 'menu')).toEqual({ showMenu: true, showToggle: false });
	});
	it('keeps a toggle only for persistent keyboards once the user typed', () => {
		expect(keyboardView(kb(), 'typing')).toEqual({ showMenu: false, showToggle: false });
		expect(keyboardView(kb({ persistent: true }), 'typing')).toEqual({ showMenu: false, showToggle: true });
	});
});

describe('keyboardSignature', () => {
	it('changes when the buttons change, not when only the placeholder does', () => {
		const a = keyboardSignature(kb());
		expect(keyboardSignature(kb({ placeholder: 'x' }))).toBe(a);
		expect(keyboardSignature(kb({ rows: [[{ label: 'B', custom_id: 'b' }]] }))).not.toBe(a);
	});
});

describe('pickActiveKeyboard', () => {
	it('returns the first keyboard or null', () => {
		expect(pickActiveKeyboard(undefined)).toBeNull();
		expect(pickActiveKeyboard([])).toBeNull();
		expect(pickActiveKeyboard([kb({ bot_id: 'x' }), kb()])?.bot_id).toBe('x');
	});
});
