import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const wsSendMessage = vi.fn();
vi.mock('@/ws', () => ({ wsSendMessage: (...a: unknown[]) => wsSendMessage(...a) }));
const state = { wsState: 'connected' };
vi.mock('@/store/store', () => ({ useAppStore: { getState: () => state } }));

import { useSendSticker } from './use-send-sticker';

describe('useSendSticker', () => {
	beforeEach(() => {
		wsSendMessage.mockReset();
		wsSendMessage.mockResolvedValue(true);
		state.wsState = 'connected';
	});

	it('sends the encoded body as a sticker message with the reply id', async () => {
		const { result } = renderHook(() => useSendSticker('c1'));
		const ok = await result.current('cove-basics', { id: 'rocket' }, 'm9');
		expect(ok).toBe(true);
		expect(wsSendMessage).toHaveBeenCalledWith(
			'c1',
			JSON.stringify({ pack_id: 'cove-basics', sticker_id: 'rocket', file_id: '' }),
			'sticker',
			'none',
			'm9',
		);
	});

	it('passes the stored file id of a user sticker', async () => {
		const { result } = renderHook(() => useSendSticker('c1'));
		await result.current('p1', { id: 'i1', file_id: 'f1' });
		expect(JSON.parse(wsSendMessage.mock.calls[0][1])).toEqual({ pack_id: 'p1', sticker_id: 'i1', file_id: 'f1' });
	});

	it('does not send while the socket is down', async () => {
		state.wsState = 'disconnected';
		const { result } = renderHook(() => useSendSticker('c1'));
		expect(await result.current('p', { id: 'i' })).toBe(false);
		expect(wsSendMessage).not.toHaveBeenCalled();
	});
});
