import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cold start: a returning user must see the app from cached state straight away, not after a server round trip.

vi.mock('@/utils/wails', () => ({ isWails: () => false }));
vi.mock('@/lib/desktop-session', () => ({
	saveDesktopSession: vi.fn(),
	clearDesktopSession: vi.fn(),
	loadDesktopSession: vi.fn().mockResolvedValue(false),
	getDesktopToken: () => null,
}));
vi.mock('@/lib/wipe', () => ({ wipeLocalData: vi.fn() }));
vi.mock('@/lib/avatarCache', () => ({ evictStaleAvatars: vi.fn().mockResolvedValue(undefined), prewarmAvatars: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/cacheCrypto', () => ({ getCacheKey: vi.fn().mockResolvedValue({}) }));

let resolveMe: (u: unknown) => void = () => {};
const apiMe = vi.fn(() => new Promise((res) => (resolveMe = res)));
vi.mock('@/api/client', () => ({
	apiLogin: vi.fn(),
	apiRegister: vi.fn(),
	apiLogout: vi.fn(),
	apiMe: () => apiMe(),
	apiUpdateProfile: vi.fn(),
	apiDeleteAccount: vi.fn(),
	apiGetMyRelationships: vi.fn().mockResolvedValue([]),
	apiGetIncomingRequests: vi.fn().mockResolvedValue([]),
	apiRelationshipAction: vi.fn(),
}));

const refreshChannels = vi.fn().mockResolvedValue(undefined);
const channelState = { channels: [] as unknown[], refreshChannels };
vi.mock('./channels.slice', () => ({
	useChannelStore: Object.assign(() => channelState, {
		getState: () => channelState,
		setState: (p: Partial<typeof channelState>) => Object.assign(channelState, p),
	}),
}));
vi.mock('./ws.manager', () => ({ connectWS: vi.fn(), disconnectWS: vi.fn() }));
const loadChannelCache = vi.fn();
vi.mock('@/lib/channel-cache', () => ({ loadChannelCache: (...a: unknown[]) => loadChannelCache(...a), saveChannelCache: vi.fn() }));

import { useAuthStore } from './auth.slice';

const saved = { id: 'u1', username: 'me', token: 't' };

describe('initAuth cold start', () => {
	beforeEach(() => {
		apiMe.mockClear();
		refreshChannels.mockClear();
		channelState.channels = [];
		loadChannelCache.mockResolvedValue([{ id: 'c1', name: 'cached' }]);
		useAuthStore.setState({ user: saved as never, isAuthLoading: true });
	});

	it('shows the app from the saved user without waiting for the server', async () => {
		const pending = useAuthStore.getState().initAuth();
		await new Promise((r) => setTimeout(r, 0));
		expect(useAuthStore.getState().isAuthLoading).toBe(false);
		expect(apiMe).toHaveBeenCalledTimes(1); // verification still runs, in the background
		resolveMe({ ...saved, username: 'fresh' });
		await pending;
		expect(useAuthStore.getState().user?.username).toBe('fresh');
	});

	it('draws the cached channel list immediately and refreshes it in parallel with the session check', async () => {
		const pending = useAuthStore.getState().initAuth();
		await new Promise((r) => setTimeout(r, 0));
		expect(channelState.channels).toEqual([{ id: 'c1', name: 'cached' }]);
		expect(refreshChannels).toHaveBeenCalledTimes(1); // started before apiMe resolved
		resolveMe(saved);
		await pending;
	});

	it('stops loading without a saved user', async () => {
		useAuthStore.setState({ user: null, isAuthLoading: true });
		await useAuthStore.getState().initAuth();
		expect(useAuthStore.getState().isAuthLoading).toBe(false);
		expect(apiMe).not.toHaveBeenCalled();
	});
});
