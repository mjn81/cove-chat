import { beforeEach, describe, expect, it } from 'vitest';

import { useBotUiStore } from './bot-ui.store';

describe('bot ui store', () => {
	beforeEach(() => useBotUiStore.setState({ modes: {} }));

	it('remembers the choice per channel and keyboard signature', () => {
		const { setMode, getMode } = useBotUiStore.getState();
		expect(getMode('c1', 'sig-a')).toBeUndefined();
		setMode('c1', 'sig-a', 'typing');
		expect(useBotUiStore.getState().getMode('c1', 'sig-a')).toBe('typing');
		expect(useBotUiStore.getState().getMode('c2', 'sig-a')).toBeUndefined();
	});

	it('forgets the choice when the bot sends a different keyboard', () => {
		useBotUiStore.getState().setMode('c1', 'sig-a', 'typing');
		expect(useBotUiStore.getState().getMode('c1', 'sig-b')).toBeUndefined();
	});
});
