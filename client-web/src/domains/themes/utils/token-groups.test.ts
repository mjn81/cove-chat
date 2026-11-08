import { describe, expect, it } from 'vitest';
import { TOKEN_GROUPS } from './token-groups';
import { THEME_TOKEN_NAMES } from './tokens';

describe('TOKEN_GROUPS', () => {
	it('lists every allow-listed token exactly once', () => {
		const all = TOKEN_GROUPS.flatMap((g) => g.tokens);
		expect([...all].sort()).toEqual([...THEME_TOKEN_NAMES].sort());
	});
});
