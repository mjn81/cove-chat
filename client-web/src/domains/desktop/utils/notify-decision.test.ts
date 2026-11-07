import { describe, expect, it } from 'vitest';

import { planMessageNotification, type MessageNotifyInput } from './notify-decision';

const base: MessageNotifyInput = {
	activeChannelId: 'c1',
	messageChannelId: 'c1',
	windowHidden: false,
	pageVisible: true,
	pageFocused: true,
};

describe('planMessageNotification', () => {
	it('treats the open conversation in a focused window as seen', () => {
		expect(planMessageNotification(base)).toEqual({ viewing: true, showPopup: false });
	});
	it('notifies for other conversations only when the window is not in front', () => {
		expect(planMessageNotification({ ...base, messageChannelId: 'c2' })).toEqual({ viewing: false, showPopup: false });
		expect(planMessageNotification({ ...base, messageChannelId: 'c2', pageFocused: false }).showPopup).toBe(true);
	});
	it('does not let the chat that was open suppress notifications once the window is hidden', () => {
		expect(planMessageNotification({ ...base, windowHidden: true })).toEqual({ viewing: false, showPopup: true });
	});
	it('notifies for every conversation while hidden, even if the page still reports visible and focused', () => {
		expect(planMessageNotification({ ...base, messageChannelId: 'c9', windowHidden: true }).showPopup).toBe(true);
	});
	it('keeps the existing behaviour for an unfocused but not hidden window: the open chat counts as seen', () => {
		expect(planMessageNotification({ ...base, pageFocused: false }).viewing).toBe(true);
		expect(planMessageNotification({ ...base, pageFocused: false }).showPopup).toBe(false);
	});
});
