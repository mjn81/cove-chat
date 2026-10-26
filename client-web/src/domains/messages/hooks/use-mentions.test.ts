import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/api/client', () => ({
	apiGetChannelMembers: vi.fn().mockResolvedValue([{ id: 'u2', username: 'alice' }]),
}));

import { useMentions } from './use-mentions';

describe('useMentions outside-click handling', () => {
	const setup = async () => {
		const input = document.createElement('textarea');
		const popup = document.createElement('div');
		popup.setAttribute('data-mention-popup', '');
		const option = document.createElement('button');
		popup.appendChild(option);
		document.body.append(input, popup);
		const { result } = renderHook(() => useMentions('c1', { current: input }));
		await waitFor(() => expect(result.current.filtered.length).toBe(1));
		act(() => result.current.track('@a', 2));
		expect(result.current.isOpen).toBe(true);
		return { result, option };
	};

	it('keeps the picker open when pressing a suggestion so its click can register', async () => {
		const { result, option } = await setup();
		act(() => void option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
		expect(result.current.isOpen).toBe(true);
	});

	it('closes the picker when pressing elsewhere', async () => {
		const { result } = await setup();
		act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
		expect(result.current.isOpen).toBe(false);
	});
});
