import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The web client authenticates via an httpOnly session cookie set by the
// backend; the raw token must never be written to localStorage there, only
// on the desktop (Wails) build, whose webview doesn't reliably persist
// httpOnly cookies. These tests guard that split.

const mockIsWails = vi.fn(() => false);
vi.mock('@/utils/wails', () => ({
	isWails: () => mockIsWails(),
}));

const mockApiLogin = vi.fn();
const mockApiRegister = vi.fn();
const mockApiLogout = vi.fn();
vi.mock('@/api/client', () => ({
	apiLogin: (...args: unknown[]) => mockApiLogin(...args),
	apiRegister: (...args: unknown[]) => mockApiRegister(...args),
	apiLogout: (...args: unknown[]) => mockApiLogout(...args),
	apiMe: vi.fn(),
	apiUpdateProfile: vi.fn(),
	apiDeleteAccount: vi.fn(),
	apiGetMyRelationships: vi.fn().mockResolvedValue([]),
	apiGetIncomingRequests: vi.fn().mockResolvedValue([]),
}));

const mockConnectWS = vi.fn();
const mockDisconnectWS = vi.fn();
vi.mock('./ws.manager', () => ({
	connectWS: (...args: unknown[]) => mockConnectWS(...args),
	disconnectWS: (...args: unknown[]) => mockDisconnectWS(...args),
}));

const mockRefreshChannels = vi.fn().mockResolvedValue(undefined);
const mockResetChannels = vi.fn();
vi.mock('./channels.slice', () => ({
	useChannelStore: {
		getState: () => ({
			refreshChannels: mockRefreshChannels,
			resetChannels: mockResetChannels,
		}),
	},
}));

// Imported after the mocks above so the module under test picks them up.
const { useAuthStore } = await import('./auth.slice');

function resetLocalStorage() {
	localStorage.clear();
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsWails.mockReturnValue(false);
	resetLocalStorage();
	useAuthStore.setState({ user: null, isAuthLoading: false });
});

afterEach(() => {
	resetLocalStorage();
});

describe('auth.slice login — web (non-Wails)', () => {
	it('never writes the session token to localStorage', async () => {
		mockApiLogin.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			domain: 'localhost',
			status: 'online',
			status_preference: '',
			token: 'super-secret-token',
		});

		await useAuthStore.getState().login('alice', 'password123');

		expect(localStorage.getItem('nodetalk_token')).toBeNull();
	});

	it('excludes the token from the persisted (localStorage "auth") user object', async () => {
		mockApiLogin.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			domain: 'localhost',
			status: 'online',
			status_preference: '',
			token: 'super-secret-token',
		});

		await useAuthStore.getState().login('alice', 'password123');

		const raw = localStorage.getItem('auth');
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw!);
		expect(parsed.state.user).not.toBeNull();
		expect(parsed.state.user.token).toBeUndefined();
		// The rest of the profile should still be persisted for UX purposes.
		expect(parsed.state.user.username).toBe('alice');
	});

	it('still keeps the token in in-memory state for this session (e.g. WS connect)', async () => {
		mockApiLogin.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			domain: 'localhost',
			status: 'online',
			status_preference: '',
			token: 'super-secret-token',
		});

		await useAuthStore.getState().login('alice', 'password123');

		expect(mockConnectWS).toHaveBeenCalledWith('super-secret-token');
	});
});

describe('auth.slice login — desktop (Wails)', () => {
	it('persists the session token to localStorage for the Wails webview', async () => {
		mockIsWails.mockReturnValue(true);
		mockApiLogin.mockResolvedValue({
			id: 'u1',
			username: 'bob',
			domain: 'localhost',
			status: 'online',
			status_preference: '',
			token: 'desktop-token',
		});

		await useAuthStore.getState().login('bob', 'password123');

		expect(localStorage.getItem('nodetalk_token')).toBe('desktop-token');
	});
});

describe('auth.slice logout', () => {
	it('clears the desktop token on logout when running under Wails', async () => {
		mockIsWails.mockReturnValue(true);
		localStorage.setItem('nodetalk_token', 'stale-token');
		mockApiLogout.mockResolvedValue(undefined);

		await useAuthStore.getState().logout();

		expect(localStorage.getItem('nodetalk_token')).toBeNull();
	});

	it('is a no-op on the desktop token for the web build (nothing to clear)', async () => {
		mockIsWails.mockReturnValue(false);
		mockApiLogout.mockResolvedValue(undefined);

		await useAuthStore.getState().logout();

		expect(localStorage.getItem('nodetalk_token')).toBeNull();
	});
});

describe('auth.slice register', () => {
	it('registers and then immediately logs in the user directly', async () => {
		mockApiRegister.mockResolvedValue({ id: 'u2', username: 'carol' });
		mockApiLogin.mockResolvedValue({
			id: 'u2',
			username: 'carol',
			domain: 'localhost',
			status: 'online',
			status_preference: '',
			token: 'carol-token',
		});

		await useAuthStore.getState().register('carol', 'password123');

		expect(mockApiRegister).toHaveBeenCalledWith('carol', 'password123', undefined);
		expect(mockApiLogin).toHaveBeenCalledWith('carol', 'password123');
		expect(useAuthStore.getState().user?.username).toBe('carol');
		expect(mockConnectWS).toHaveBeenCalledWith('carol-token');
	});
});
