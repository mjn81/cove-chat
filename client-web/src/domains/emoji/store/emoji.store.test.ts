import { describe, it, expect, beforeEach } from 'vitest';
import { useEmojiSettings } from './emoji.store';

describe('emoji panel settings', () => {
	beforeEach(() => useEmojiSettings.setState({ panelMode: 'popover', dockOpen: false }));

	it('starts as a popover with the dock closed', () => {
		expect(useEmojiSettings.getState().panelMode).toBe('popover');
		expect(useEmojiSettings.getState().dockOpen).toBe(false);
	});

	it('remembers the chosen mode and open state', () => {
		useEmojiSettings.getState().setPanelMode('dock');
		useEmojiSettings.getState().setDockOpen(true);
		expect(useEmojiSettings.getState()).toMatchObject({ panelMode: 'dock', dockOpen: true });
		expect(JSON.parse(localStorage.getItem('cove_emoji_settings') ?? '{}').state).toMatchObject({ panelMode: 'dock', dockOpen: true });
	});
});
