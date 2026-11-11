import { describe, expect, it } from 'vitest';

import { isValidBotName } from './bot-name';

describe('isValidBotName', () => {
	it('accepts what the server accepts', () => {
		for (const ok of ['ab', 'pingbot', 'my-bot_2', 'a.b', '0bot']) expect(isValidBotName(ok)).toBe(true);
	});
	it('rejects the rest', () => {
		for (const bad of ['', 'a', 'Admin', '-bot', 'has space', 'a'.repeat(33), 'bot!', 'ربات']) {
			expect(isValidBotName(bad)).toBe(false);
		}
	});
});
